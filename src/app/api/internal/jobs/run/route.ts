import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireWorkerAuth, WorkerAuthError } from "@/lib/jobs/workerAuth";
import { claimJobBatch, reclaimStaleLeases, completeJob, retryOrFailJob } from "@/lib/jobs/backgroundJobs";
import { dispatchJob } from "@/lib/jobs/jobHandlers";
import { WORKER_CONFIG } from "@/lib/jobs/workerConfig";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";

/**
 * The Stage 2 background-job worker — see workerConfig.ts for the exact
 * runtime-budget numbers and the reasoning behind each. Scheduler-
 * agnostic by design (Stage 2 architecture checkpoint): this route only
 * knows how to authenticate, claim, process, and return. It is invoked by
 * Vercel Cron once production is on a plan that supports the required
 * frequency (Pro), and by an authenticated manual request for
 * sandbox/testing convenience in the meantime — never by an unauthenticated
 * caller, and never with any behavior that depends on WHICH of those
 * triggered it.
 *
 * Correctness does not depend on this function completing. If the Vercel
 * instance disappears mid-run, every claimed-but-unfinished job is left
 * PROCESSING with a lease (see claimJobBatch) — the NEXT invocation's
 * reclaimStaleLeases() call recovers it once that lease expires. Nothing
 * here is a single point of failure for correctness, only for throughput.
 */
export const maxDuration = 300; // matches WORKER_CONFIG.FUNCTION_MAX_DURATION_MS

interface JobOutcome {
  jobId: string;
  jobType: string;
  result: "COMPLETED" | "RETRY" | "FAILED";
}

async function processOneJob(job: Awaited<ReturnType<typeof claimJobBatch>>[number]): Promise<JobOutcome> {
  try {
    await dispatchJob(job);
    await completeJob(job.id);
    return { jobId: job.id, jobType: job.jobType, result: "COMPLETED" };
  } catch (err) {
    const outcome = await retryOrFailJob(job, err);
    return { jobId: job.id, jobType: job.jobType, result: outcome };
  }
}

export async function POST(req: Request) {
  try {
    requireWorkerAuth(req);
  } catch (err) {
    if (err instanceof WorkerAuthError) {
      // Never echo the provided/expected secret, never include it in any
      // field of this response.
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const startedAt = Date.now();
  const workerId = `worker-${randomUUID()}`;

  // Opportunistic — cheap, and means a worker that starts right after
  // another one died recovers that one's stranded leases before doing its
  // own claim, rather than waiting for a later invocation.
  const reclaimedCount = await reclaimStaleLeases();

  let claimedTotal = 0;
  let completedTotal = 0;
  let retriedTotal = 0;
  let failedTotal = 0;

  while (Date.now() - startedAt < WORKER_CONFIG.SAFE_BUDGET_MS) {
    const batch = await claimJobBatch({
      workerId,
      batchSize: WORKER_CONFIG.CLAIM_BATCH_SIZE,
      leaseSeconds: WORKER_CONFIG.LEASE_DURATION_SECONDS,
    });
    if (batch.length === 0) break; // nothing left to claim right now

    claimedTotal += batch.length;

    for (let i = 0; i < batch.length; i += WORKER_CONFIG.PROCESSING_CONCURRENCY) {
      const slice = batch.slice(i, i + WORKER_CONFIG.PROCESSING_CONCURRENCY);
      const outcomes = await Promise.all(slice.map(processOneJob));
      for (const outcome of outcomes) {
        if (outcome.result === "COMPLETED") completedTotal++;
        else if (outcome.result === "RETRY") retriedTotal++;
        else failedTotal++;
      }
      // Budget check between concurrency-slices too, not just between
      // whole batches — a slow slice shouldn't be followed by starting a
      // fresh slice that has no realistic chance of finishing in budget.
      if (Date.now() - startedAt >= WORKER_CONFIG.SAFE_BUDGET_MS) break;
    }

    if (batch.length < WORKER_CONFIG.CLAIM_BATCH_SIZE) break; // drained the queue
  }

  const durationMs = Date.now() - startedAt;
  logPaymentSafetyEvent("BACKGROUND_JOB_CLAIMED", {
    detail: `worker=${workerId} claimed=${claimedTotal} completed=${completedTotal} retried=${retriedTotal} failed=${failedTotal} reclaimed=${reclaimedCount} durationMs=${durationMs}`,
    route: "/api/internal/jobs/run",
  });

  return NextResponse.json({
    workerId,
    claimed: claimedTotal,
    completed: completedTotal,
    retried: retriedTotal,
    failed: failedTotal,
    reclaimedStaleLeases: reclaimedCount,
    durationMs,
  });
}
