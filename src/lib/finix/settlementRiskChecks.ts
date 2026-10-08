import { computeReconciliation } from "@/lib/finix/settlementReconciliation";

/**
 * Decision-support checks for the "should this settlement actually pay out"
 * question Finix currently answers for us before every settlement — built
 * ahead of the Settlement Approval addendum with Finix so we have real
 * calibration data (run this against months of already-settled history)
 * before that responsibility ever moves to us.
 *
 * Deliberately NOT wired to any Finix approve/reject call. Finix hasn't
 * given us API docs for their settlement-review workflow (what marks a
 * settlement "open, pending approval" vs. approved, the exact PUT payload,
 * what happens on a missed cutoff) — writing that integration now would
 * mean guessing at a money-moving API, which is worse than not having it
 * yet. This module is read-only: it flags what our own checks WOULD say,
 * for a human to look at, nothing more.
 */

// Starting points, not calibrated against real data yet — expect to tune
// these once this has run against a real settlement history. A spike
// multiplier of 3x and a $1 reconciliation tolerance are conservative
// defaults chosen to avoid false alarms more than to catch every anomaly.
const MIN_BASELINE_SAMPLE_SIZE = 4;
const SPIKE_MULTIPLIER = 3;
const RECONCILIATION_TOLERANCE_CENTS = 100;

export interface SettlementSnapshot {
  finixSettlementId: string;
  totalAmountCents: number | null;
  netAmountCents: number | null;
  feeAmountCents: number | null;
  refundAmountCents: number | null;
  returnAmountCents: number | null;
  disputeAmountCents: number | null;
  transactionCount: number | null;
  refundCount: number | null;
}

export interface SettlementBaseline {
  avgTotalAmountCents: number;
  avgRefundAmountCents: number;
  avgRefundCount: number;
  avgTransactionCount: number;
  sampleSize: number;
}

export interface RiskFlag {
  code: "RECONCILIATION_MISMATCH" | "TOTAL_AMOUNT_SPIKE" | "REFUND_AMOUNT_SPIKE" | "REFUND_COUNT_SPIKE" | "COUNT_TOTAL_INCONSISTENT";
  severity: "high" | "medium";
  message: string;
}

/**
 * Baseline drawn from a church's own recent settlement history — every
 * check is relative to what's normal FOR THIS MERCHANT, not a sitewide
 * number, since a small church's "normal" settlement is a large church's
 * quiet week. Returns null when there isn't enough history yet to trust an
 * average (a new merchant's first few settlements would otherwise compare
 * against themselves and never flag anything, or compare against 1-2
 * samples and flag everything).
 */
export function computeSettlementBaseline(history: SettlementSnapshot[]): SettlementBaseline | null {
  if (history.length < MIN_BASELINE_SAMPLE_SIZE) return null;

  const sum = (pick: (s: SettlementSnapshot) => number | null) =>
    history.reduce((total, s) => total + (pick(s) ?? 0), 0);

  return {
    avgTotalAmountCents: sum((s) => s.totalAmountCents) / history.length,
    avgRefundAmountCents: sum((s) => s.refundAmountCents) / history.length,
    avgRefundCount: sum((s) => s.refundCount) / history.length,
    avgTransactionCount: sum((s) => s.transactionCount) / history.length,
    sampleSize: history.length,
  };
}

/**
 * Evaluates one settlement against its merchant's baseline. Every check
 * here is something a human reviewing this settlement could verify by eye
 * in under a minute — that's deliberate: these are meant to be a fast
 * pre-filter for a human's attention, not a black-box auto-decision.
 */
export function evaluateSettlementRisk(settlement: SettlementSnapshot, baseline: SettlementBaseline | null): RiskFlag[] {
  const flags: RiskFlag[] = [];

  const reconciliation = computeReconciliation(settlement);
  if (reconciliation.differenceCents != null && Math.abs(reconciliation.differenceCents) > RECONCILIATION_TOLERANCE_CENTS) {
    flags.push({
      code: "RECONCILIATION_MISMATCH",
      severity: "high",
      message: `Finix's reported net differs from gross minus fees/refunds/returns/disputes by ${(reconciliation.differenceCents / 100).toFixed(2)}.`,
    });
  }

  const total = settlement.totalAmountCents ?? 0;
  const txnCount = settlement.transactionCount ?? 0;
  if ((total > 0 && txnCount === 0) || (total === 0 && txnCount > 0)) {
    flags.push({
      code: "COUNT_TOTAL_INCONSISTENT",
      severity: "high",
      message: `Transaction count (${txnCount}) and total amount (${(total / 100).toFixed(2)}) don't agree on whether this settlement has any activity.`,
    });
  }

  if (baseline) {
    if (baseline.avgTotalAmountCents > 0 && total > baseline.avgTotalAmountCents * SPIKE_MULTIPLIER) {
      flags.push({
        code: "TOTAL_AMOUNT_SPIKE",
        severity: "medium",
        message: `Total (${(total / 100).toFixed(2)}) is more than ${SPIKE_MULTIPLIER}x this merchant's recent average (${(baseline.avgTotalAmountCents / 100).toFixed(2)}, from ${baseline.sampleSize} settlements).`,
      });
    }

    const refundAmount = settlement.refundAmountCents ?? 0;
    if (baseline.avgRefundAmountCents > 0 && refundAmount > baseline.avgRefundAmountCents * SPIKE_MULTIPLIER) {
      flags.push({
        code: "REFUND_AMOUNT_SPIKE",
        severity: "medium",
        message: `Refund amount (${(refundAmount / 100).toFixed(2)}) is more than ${SPIKE_MULTIPLIER}x this merchant's recent average (${(baseline.avgRefundAmountCents / 100).toFixed(2)}).`,
      });
    }

    const refundCount = settlement.refundCount ?? 0;
    if (baseline.avgRefundCount > 0 && refundCount > baseline.avgRefundCount * SPIKE_MULTIPLIER) {
      flags.push({
        code: "REFUND_COUNT_SPIKE",
        severity: "medium",
        message: `Refund count (${refundCount}) is more than ${SPIKE_MULTIPLIER}x this merchant's recent average (${baseline.avgRefundCount.toFixed(1)}).`,
      });
    }
  }

  return flags;
}
