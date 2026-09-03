import type { BackgroundJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendDonationReceipt } from "@/lib/giving/generateReceipt";
import { syncPaymentToQuickBooks } from "@/lib/integrations/quickbooks/sync";
import { computePledgeFulfillment } from "@/lib/pledges/pledgeFulfillment";
import type { JobType } from "./backgroundJobs";

/**
 * The dispatch table the worker route uses to execute a claimed job.
 * Every handler MUST be safe to execute more than once for the same job
 * (a lease can expire and be reclaimed after a handler partially ran, or
 * the same job can be claimed again after a RETRY) — see each handler's
 * own comment for its specific idempotency mechanism.
 *
 * A handler that "succeeds" without doing real work (e.g. the org never
 * connected QuickBooks, so there's nothing to sync) must return normally,
 * not throw — only a genuine failure should trigger retry/backoff.
 */
export type JobHandler = (job: BackgroundJob) => Promise<void>;

/**
 * sendDonationReceipt() throws on a genuine send failure and returns
 * { duplicate: true } (not an error) on the P2002 idempotency case — see
 * generateReceipt.ts's DonationReceipt(paymentId, version) unique
 * constraint. A thin wrapper is correct here: whatever it does is already
 * the right retry/complete signal.
 */
async function handleSendReceipt(job: BackgroundJob): Promise<void> {
  const { paymentId, churchId } = job.payloadJson as { paymentId: string; churchId: string };
  await sendDonationReceipt(paymentId, churchId);
}

/**
 * syncPaymentToQuickBooks() is deliberately fire-and-forget at its own
 * call sites — it NEVER throws, it records the outcome on
 * QuickBooksSyncRecord.status and returns normally either way (see that
 * file's own doc comment). For this to actually retry/back off through
 * the outbox on a real failure, this handler reads that same record back
 * and throws if the sync it just attempted recorded FAILED. Idempotent by
 * construction: syncPaymentToQuickBooks itself short-circuits on an
 * existing SUCCEEDED record, so re-running this handler after a prior
 * partial failure never double-syncs.
 */
async function handleQuickBooksPayment(job: BackgroundJob): Promise<void> {
  const { paymentId } = job.payloadJson as { paymentId: string };
  await syncPaymentToQuickBooks(paymentId);
  const record = await prisma.quickBooksSyncRecord.findFirst({
    where: { entityType: "PAYMENT", localEntityId: paymentId },
    orderBy: { createdAt: "desc" },
  });
  // No record at all means syncPaymentToQuickBooks's own early-return gate
  // fired (integration disabled, or this church never connected) — a
  // legitimate no-op, not a failure.
  if (record?.status === "FAILED") {
    throw new Error(record.errorMessage || "QuickBooks sync failed");
  }
}

/** computePledgeFulfillment() recomputes the pledge's fulfilled amount
 * from source Payment/ExternalDonation rows every time it runs and
 * propagates real errors naturally — inherently safe to retry, and
 * inherently self-correcting even if a run is skipped entirely (the next
 * trigger recomputes the true total from scratch, never from job state). */
async function handlePledgeRecompute(job: BackgroundJob): Promise<void> {
  const { pledgeId } = job.payloadJson as { pledgeId: string };
  await computePledgeFulfillment(pledgeId);
}

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  SEND_RECEIPT: handleSendReceipt,
  QUICKBOOKS_PAYMENT: handleQuickBooksPayment,
  PLEDGE_RECOMPUTE: handlePledgeRecompute,
  // APLOS_PAYMENT, PRINTFUL_ORDER, SEND_PLAIN_EMAIL, ANALYTICS_RECORD: not
  // yet implemented — PRINTFUL_ORDER deliberately waits for the Task 9
  // payment/fulfillment-status separation.
};

export class NoHandlerRegisteredError extends Error {
  constructor(jobType: string) {
    super(`No handler registered for job type "${jobType}"`);
    this.name = "NoHandlerRegisteredError";
  }
}

export async function dispatchJob(job: BackgroundJob): Promise<void> {
  const handler = JOB_HANDLERS[job.jobType as JobType];
  if (!handler) throw new NoHandlerRegisteredError(job.jobType);
  await handler(job);
}
