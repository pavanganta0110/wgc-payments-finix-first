import type { BackgroundJob } from "@prisma/client";
import type { JobType } from "./backgroundJobs";

/**
 * The dispatch table the worker route uses to execute a claimed job.
 * Populated incrementally (Stage 2 Task 4: receipt email, QuickBooks sync,
 * pledge recomputation, invoice receipt — lowest-risk first; Printful
 * stays out until its fulfillment-state model exists, per that task's
 * explicit instruction).
 *
 * Every handler MUST be safe to execute more than once for the same job
 * (a lease can expire and be reclaimed after a handler partially ran) —
 * see each handler's own doc comment for its specific idempotency
 * mechanism once implemented.
 */
export type JobHandler = (job: BackgroundJob) => Promise<void>;

export const JOB_HANDLERS: Partial<Record<JobType, JobHandler>> = {
  // Filled in by Task 4.
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
