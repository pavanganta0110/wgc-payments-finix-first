import { Prisma, type BackgroundJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";

/**
 * The Stage 2 durable job/outbox library. See
 * prisma/migration_draft/stage2_background_processing/ for the schema this
 * backs, and STAGE2_ARCHITECTURE.md for the full design writeup.
 *
 * Every function here is safe to call from multiple concurrent Vercel
 * instances — nothing here depends on in-process state.
 */

export type BackgroundJobStatus = "PENDING" | "PROCESSING" | "RETRY" | "COMPLETED" | "FAILED";

/** Every job type this system knows about. Keep this list in sync with
 * the actual worker dispatch table in src/lib/jobs/worker.ts. */
export const JOB_TYPES = [
  "SEND_RECEIPT",
  "SEND_PLAIN_EMAIL",
  "QUICKBOOKS_PAYMENT",
  "APLOS_PAYMENT",
  "PRINTFUL_ORDER",
  "PLEDGE_RECOMPUTE",
  "ANALYTICS_RECORD",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

// Different job types get different backoff policies (Task 12) —
// external-integration jobs that are likely to be transiently down
// (QuickBooks, Aplos, Printful) get a longer max window than a cheap
// internal-only job like analytics. All are exponential with jitter.
const BACKOFF_POLICIES: Record<JobType, number[]> = {
  // attempt N's delay, in seconds, before that attempt runs (index 0 = delay before attempt 2, since attempt 1 always runs at nextRunAt = now()).
  SEND_RECEIPT: [30, 120, 600, 1800, 3600, 3600, 3600],
  SEND_PLAIN_EMAIL: [30, 120, 600, 1800, 3600, 3600, 3600],
  QUICKBOOKS_PAYMENT: [30, 120, 600, 1800, 3600, 7200, 21600],
  APLOS_PAYMENT: [30, 120, 600, 1800, 3600, 7200, 21600],
  PRINTFUL_ORDER: [30, 120, 600, 1800, 3600, 7200, 21600],
  PLEDGE_RECOMPUTE: [30, 120, 600, 1800],
  ANALYTICS_RECORD: [30, 120, 600, 1800],
};

function backoffDelaySeconds(jobType: JobType, attempts: number): number {
  const policy = BACKOFF_POLICIES[jobType];
  const base = policy[Math.min(attempts - 1, policy.length - 1)];
  // +/-20% jitter so many jobs that failed at the same instant (e.g. a
  // QuickBooks outage) don't all retry in the exact same instant again.
  const jitter = base * (0.8 + Math.random() * 0.4);
  return Math.round(jitter);
}

export interface EnqueueInput {
  jobType: JobType;
  entityType: string;
  entityId: string;
  /** Must be globally unique per logical job — see the module doc comment
   * for the convention. This IS the idempotency mechanism for the enqueue
   * path itself (Stage 2 addendum #3), backed by a real DB unique
   * constraint (BackgroundJob.dedupeKey) — never a SELECT-then-INSERT. */
  dedupeKey: string;
  payload: Prisma.InputJsonValue;
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: BackgroundJob;
  /** true if this call created a NEW row; false if a job with this
   * dedupeKey already existed (this call recovered it via P2002) — a
   * genuinely different logical caller (checkout vs. webhook vs.
   * reconciler) racing to enqueue the same job collapses to one row
   * either way. */
  isFreshEnqueue: boolean;
}

/**
 * Idempotent enqueue — safe to call concurrently from multiple callers
 * (checkout path, webhook path, reconciliation worker, a manual retry)
 * for the exact same logical job. Never SELECT-then-INSERT: the INSERT's
 * own P2002 on the unique dedupeKey IS the race-safety mechanism.
 */
export async function enqueueBackgroundJob(input: EnqueueInput): Promise<EnqueueResult> {
  try {
    const job = await prisma.backgroundJob.create({
      data: {
        jobType: input.jobType,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
        payloadJson: input.payload,
        maxAttempts: input.maxAttempts ?? 8,
      },
    });
    logPaymentSafetyEvent("BACKGROUND_JOB_CREATED", {
      detail: `${input.jobType} dedupeKey=${input.dedupeKey}`,
      route: "enqueueBackgroundJob",
    });
    return { job, isFreshEnqueue: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.backgroundJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) return { job: existing, isFreshEnqueue: false };
    }
    throw err;
  }
}

/**
 * Enqueue a job as part of an ALREADY-OPEN Prisma transaction — for the
 * transactional-outbox pattern (Stage 2 addendum #2): when a Payment and
 * its REQUIRED post-payment jobs must commit together or not at all. The
 * caller passes the `tx` client from their own `prisma.$transaction(...)`
 * call. Same P2002-safe idempotency as enqueueBackgroundJob, but callable
 * inside a transaction (a plain `await enqueueBackgroundJob` would use the
 * top-level `prisma` client, a DIFFERENT connection, and therefore would
 * NOT be part of the caller's transaction).
 */
export async function enqueueBackgroundJobInTransaction(
  tx: Prisma.TransactionClient,
  input: EnqueueInput
): Promise<EnqueueResult> {
  try {
    const job = await tx.backgroundJob.create({
      data: {
        jobType: input.jobType,
        entityType: input.entityType,
        entityId: input.entityId,
        dedupeKey: input.dedupeKey,
        payloadJson: input.payload,
        maxAttempts: input.maxAttempts ?? 8,
      },
    });
    return { job, isFreshEnqueue: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await tx.backgroundJob.findUnique({ where: { dedupeKey: input.dedupeKey } });
      if (existing) return { job: existing, isFreshEnqueue: false };
    }
    throw err;
  }
}

/**
 * Atomic batch claim — the core of Task 3. Multiple concurrent workers
 * (multiple Vercel instances) calling this simultaneously will never
 * receive overlapping rows: this is a single UPDATE statement whose WHERE
 * clause is `id IN (SELECT ... FOR UPDATE SKIP LOCKED)`, so the row-lock
 * from the subquery is held for the SAME statement that flips status to
 * PROCESSING — there is no separate "SELECT pending, then UPDATE them"
 * step for a second worker to race into between them. Any row already
 * locked by another concurrent claim (still mid-transaction) is silently
 * skipped (SKIP LOCKED) rather than blocked on.
 */
export async function claimJobBatch(params: { workerId: string; batchSize: number; leaseSeconds: number }): Promise<BackgroundJob[]> {
  const { workerId, batchSize, leaseSeconds } = params;
  const claimed = await prisma.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob"
    SET status = 'PROCESSING',
        "lockedAt" = now(),
        "leaseUntil" = now() + (${leaseSeconds}::text || ' seconds')::interval,
        "workerId" = ${workerId},
        attempts = attempts + 1,
        "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "BackgroundJob"
      WHERE status IN ('PENDING', 'RETRY')
        AND "nextRunAt" <= now()
      ORDER BY "nextRunAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING *;
  `;
  if (claimed.length > 0) {
    logPaymentSafetyEvent("BACKGROUND_JOB_CLAIMED", { detail: `worker=${workerId} count=${claimed.length}`, route: "claimJobBatch" });
  }
  return claimed;
}

/**
 * Reclaim stale leases (Task 3/17 scenario 1: a worker claimed a job then
 * died before finishing) — flips expired PROCESSING rows back to RETRY so
 * the next claim batch can pick them up. Same atomic UPDATE-with-
 * FOR-UPDATE-SKIP-LOCKED shape, so this is itself safe to call
 * concurrently with claimJobBatch and with another worker's own stale-
 * recovery pass.
 */
export async function reclaimStaleLeases(): Promise<number> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "BackgroundJob"
    SET status = 'RETRY',
        "workerId" = NULL,
        "lockedAt" = NULL,
        "leaseUntil" = NULL,
        "lastError" = COALESCE("lastError", '') || ' [lease expired, reclaimed]',
        "lastErrorAt" = now(),
        "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM "BackgroundJob"
      WHERE status = 'PROCESSING' AND "leaseUntil" IS NOT NULL AND "leaseUntil" < now()
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id;
  `;
  return rows.length;
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { status: "COMPLETED", completedAt: new Date(), leaseUntil: null, lockedAt: null, workerId: null },
  });
  logPaymentSafetyEvent("BACKGROUND_JOB_COMPLETED", { detail: jobId, route: "completeJob" });
}

/**
 * Marks a job for retry (if under maxAttempts) or permanently FAILED (if
 * not) — permanent errors must eventually stop retrying (Task 12).
 */
export async function retryOrFailJob(job: Pick<BackgroundJob, "id" | "jobType" | "attempts" | "maxAttempts">, error: unknown): Promise<"RETRY" | "FAILED"> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (job.attempts >= job.maxAttempts) {
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: { status: "FAILED", failedAt: new Date(), lastError: message, lastErrorAt: new Date(), leaseUntil: null, lockedAt: null, workerId: null },
    });
    logPaymentSafetyEvent("BACKGROUND_JOB_FAILED", { detail: `${job.id} ${job.jobType} attempts=${job.attempts}`, route: "retryOrFailJob" });
    return "FAILED";
  }
  const delaySeconds = backoffDelaySeconds(job.jobType as JobType, job.attempts);
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: "RETRY",
      nextRunAt: new Date(Date.now() + delaySeconds * 1000),
      lastError: message,
      lastErrorAt: new Date(),
      leaseUntil: null,
      lockedAt: null,
      workerId: null,
    },
  });
  logPaymentSafetyEvent("BACKGROUND_JOB_RETRY", { detail: `${job.id} ${job.jobType} attempt=${job.attempts} delay=${delaySeconds}s`, route: "retryOrFailJob" });
  return "RETRY";
}
