import { findStaleRefundRequests, reconcileRefundRequest } from "@/lib/payments/refundReconciliation";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { emptyOutcomeCounts, type ReconciliationOutcome, type SweepSummary } from "./outcomes";

/**
 * Stage 2 Task 8 — the thinnest of the three sweeps, because Stage 1
 * already built the entire repair primitive
 * (src/lib/payments/refundReconciliation.ts) and left it unwired; this
 * file is only the scheduling orchestration `findStaleRefundRequests` /
 * `reconcileRefundRequest`'s own doc comments say a Stage 2 worker would
 * add. No new refund logic exists here — `reconcileRefundRequest` never
 * creates a Finix reversal, only discovers and records the real result of
 * one WGC already (ambiguously) attempted; see that file for the full
 * money-safety proof.
 */

function classifyRefundOutcome(result: Awaited<ReturnType<typeof reconcileRefundRequest>>): ReconciliationOutcome {
  switch (result.outcome) {
    case "reconciled_succeeded":
      return "RECOVERED";
    case "reconciled_failed":
      return "NOT_FOUND"; // Finix had no record of the reversal at all
    case "still_unknown":
      return "STILL_UNCERTAIN";
    case "error":
      return "RETRYABLE_ERROR";
  }
}

export async function reconcileStaleRefunds(limit = 50): Promise<SweepSummary> {
  const outcomes = emptyOutcomeCounts();
  const candidates = await findStaleRefundRequests(undefined, limit);

  if (candidates.length === 0) return { candidatesChecked: 0, outcomes };

  logPaymentSafetyEvent("REFUND_RECONCILIATION_STARTED", { source: "reconciliation", detail: `stale-refund sweep, candidates=${candidates.length}` });

  for (const refundRequest of candidates) {
    try {
      const result = await reconcileRefundRequest(refundRequest.id);
      const outcome = classifyRefundOutcome(result);
      outcomes[outcome]++;
      // reconcileRefundRequest already emits its own REFUND_RECONCILED /
      // REFUND_RECONCILIATION_FAILED / REFUND_STUCK events per-item — this
      // sweep only adds the batch-level STARTED marker above and an
      // UNRESOLVED rollup for anything still ambiguous after this pass.
      if (outcome === "STILL_UNCERTAIN" || outcome === "RETRYABLE_ERROR") {
        logPaymentSafetyEvent("REFUND_RECONCILIATION_UNRESOLVED", {
          refundRequestId: refundRequest.id,
          finixTransferId: refundRequest.finixTransferId,
          source: "reconciliation",
          detail: result.outcome === "error" ? result.error : result.outcome,
        });
      }
    } catch (err) {
      // reconcileRefundRequest itself already catches everything internally
      // and returns { outcome: "error" } rather than throwing — this catch
      // exists only as a last-resort guard against a bug in the sweep loop
      // itself, never expected to fire in normal operation.
      outcomes.PERMANENT_ERROR++;
      console.error(`Refund reconciliation sweep: unexpected error for RefundRequest ${refundRequest.id}:`, err);
    }
  }

  return { candidatesChecked: candidates.length, outcomes };
}
