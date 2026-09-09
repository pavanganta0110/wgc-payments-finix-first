/**
 * Structured, greppable log lines for the money-safety events Stage 1
 * introduced — searchable in Vercel logs today, not waiting on Stage 3's
 * real observability/alerting infra. Every one of these represents a
 * safety mechanism doing exactly what it's supposed to (the donor/admin
 * response stays successful) — they exist so WGC OPERATIONS can see how
 * often duplicate-prevention and uncertain-state handling actually fire in
 * production, not because anything went wrong.
 *
 * Deliberately narrow payload shape — only identifiers safe to log. Never
 * pass card/bank/CVV/secret/token data or unnecessary donor PII (name,
 * email, phone, address) through this helper.
 */

export type PaymentSafetyEvent =
  | "PAYMENT_DUPLICATE_PREVENTED"
  | "REFUND_DUPLICATE_PREVENTED"
  | "ORPHAN_PAYMENT_RECOVERED"
  | "PAYMENT_STATUS_UNCERTAIN"
  | "REFUND_STATUS_UNCERTAIN"
  // Emitted by refundReconciliation.ts's reusable repair function — the
  // function itself has no automatic trigger in Stage 1 (see that file's
  // module comment); a Stage 2 scheduled worker is what actually calls it
  // on a cadence.
  | "REFUND_RECONCILED"
  | "REFUND_RECONCILIATION_FAILED"
  | "REFUND_STUCK";

export interface PaymentSafetyEventFields {
  churchId?: string | null;
  paymentAttemptId?: string | null;
  finixTransferId?: string | null;
  refundRequestId?: string | null;
  finixReversalId?: string | null;
  /** Where the duplicate/uncertain outcome was decided — e.g. "checkout", "webhook", "orphan_recovery". */
  source?: string;
  /** The API route this fired from, for correlating with request logs. */
  route?: string;
  /** Free-text, non-sensitive context — e.g. "P2002 on Payment.finixTransferId". */
  detail?: string;
}

export function logPaymentSafetyEvent(event: PaymentSafetyEvent, fields: PaymentSafetyEventFields): void {
  console.warn(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    })
  );
}
