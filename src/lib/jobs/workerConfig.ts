/**
 * Stage 2 worker tunables — centralized here (never scattered magic
 * constants through the codebase) so they can be adjusted without hunting
 * through the worker route. See the Stage 2 report for the reasoning
 * behind each value.
 *
 * FUNCTION MAX: 300s — the actual, verified Vercel limit for both the
 * production (wgc-payments-live) and sandbox (wgc-payments-finix-first)
 * projects on their current Hobby plan WITH Fluid Compute enabled
 * (confirmed live via the Vercel API, not assumed — see the Stage 2
 * architecture-checkpoint report). Pro would allow higher, but nothing
 * here needs more than this budget uses.
 */
export const WORKER_CONFIG = {
  /** Real platform ceiling — a function invocation is killed at this point
   * regardless of what this file says. Never claim new work this close to
   * it. */
  FUNCTION_MAX_DURATION_MS: 300_000,

  /**
   * Stop claiming NEW batches once this much wall-clock time has elapsed
   * since the worker started — chosen at 60% of the function ceiling
   * (180s of 300s), leaving a wide safety margin for: the last claimed
   * batch to finish processing (bounded below by LEASE_DURATION_MS), the
   * final DB writes, and the HTTP response itself, without ever risking
   * the platform killing the function mid-write. If the runtime disappears
   * anyway (Vercel kills it, a crash, anything), no correctness is lost —
   * claimed jobs sit as PROCESSING with a lease, and the next worker
   * invocation's reclaimStaleLeases() call recovers them once that lease
   * expires. This budget only protects THROUGHPUT within one invocation,
   * never correctness.
   */
  SAFE_BUDGET_MS: 180_000,

  /**
   * How many jobs one claim call takes at once. Chosen conservatively
   * (not the addendum's example number, chosen for this project): the
   * sandbox Supabase pooler is confirmed limited to pool_size: 15 total
   * connections (see STAGE3_DB_CONNECTION_POOL_FINDING.md), shared with
   * the checkout path, which must always get priority. A worker that
   * claims dozens of jobs and holds many connections open concurrently
   * would directly compete with donors mid-checkout for the same scarce
   * pool. 10 keeps the worker's own footprint small relative to that
   * budget even under PROCESSING_CONCURRENCY below.
   */
  CLAIM_BATCH_SIZE: 10,

  /**
   * How many jobs from a claimed batch are processed at once (not all 10
   * simultaneously) — bounds how many external HTTP connections
   * (QuickBooks/Aplos/Resend/Printful) and DB connections this one worker
   * invocation holds open at any instant. 3 is deliberately small: this
   * is background work, never latency-critical, and the pool budget above
   * is the binding constraint, not throughput.
   */
  PROCESSING_CONCURRENCY: 3,

  /**
   * How long a claimed job's lease is valid before another worker may
   * reclaim it. Must comfortably exceed the worst realistic single-job
   * processing time (its own DB work + up to a couple of external HTTP
   * calls, each individually bounded by EXTERNAL_HTTP_TIMEOUT_MS below)
   * while staying well under the function's own runtime ceiling, so a
   * genuinely stuck job doesn't block reclamation for an unreasonable
   * time. 120s = comfortably more than a few 20s external calls plus
   * retries-within-the-same-attempt overhead, comfortably less than the
   * 180s safe budget.
   */
  LEASE_DURATION_SECONDS: 120,

  /**
   * Every external HTTP call a job handler makes (QuickBooks, Aplos,
   * Resend, Printful, a Finix reconciliation lookup) must be wrapped with
   * this timeout. A single hanging third-party call must never be able to
   * consume the whole worker lifetime — it should fail fast, let
   * retryOrFailJob apply backoff, and free the worker to move on to the
   * next job in its batch. 20s is generous for a real API call under
   * normal conditions while still being a small fraction of both the
   * lease duration and the safe budget.
   */
  EXTERNAL_HTTP_TIMEOUT_MS: 20_000,
} as const;

export async function withExternalTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${WORKER_CONFIG.EXTERNAL_HTTP_TIMEOUT_MS}ms`)), WORKER_CONFIG.EXTERNAL_HTTP_TIMEOUT_MS)),
  ]);
}
