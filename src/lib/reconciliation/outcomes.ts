/**
 * Stage 2 Task 8 — shared outcome vocabulary for every reconciliation
 * sweep (payments, invoice payments, refunds). Deliberately not collapsed
 * into a generic success/failure boolean — see each sweep's own summary
 * type for how these roll up, and the admin health view (future work)
 * this is designed to feed directly.
 */
export type ReconciliationOutcome =
  /** A gap was found and safely repaired (Payment/InvoicePayment/RefundRequest created or corrected from the real processor state). */
  | "RECOVERED"
  /** Nothing to do — the record had already reached its correct terminal state, possibly by a concurrent webhook/reconciler/checkout write. */
  | "ALREADY_RESOLVED"
  /** Checked, no repair possible yet (e.g. processor still hasn't reached a terminal state) — safe to leave and re-check on the next sweep. */
  | "STILL_UNCERTAIN"
  /** The processor has no record of this at all — never a signal to create anything; only ever a signal to mark the local record's true (non-)outcome. */
  | "NOT_FOUND"
  /** A transient failure (network, timeout, rate limit) — worth retrying on the next sweep, not worth alerting a human yet. */
  | "RETRYABLE_ERROR"
  /** A failure that a retry won't fix on its own (data-integrity gap, unexpected shape) — worth surfacing to a human. */
  | "PERMANENT_ERROR";

export interface SweepSummary {
  candidatesChecked: number;
  outcomes: Record<ReconciliationOutcome, number>;
}

export function emptyOutcomeCounts(): Record<ReconciliationOutcome, number> {
  return {
    RECOVERED: 0,
    ALREADY_RESOLVED: 0,
    STILL_UNCERTAIN: 0,
    NOT_FOUND: 0,
    RETRYABLE_ERROR: 0,
    PERMANENT_ERROR: 0,
  };
}
