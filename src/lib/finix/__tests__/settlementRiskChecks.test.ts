import { describe, it, expect } from "vitest";
import { computeSettlementBaseline, evaluateSettlementRisk, type SettlementSnapshot } from "@/lib/finix/settlementRiskChecks";

function snapshot(overrides: Partial<SettlementSnapshot> = {}): SettlementSnapshot {
  return {
    finixSettlementId: "STtest",
    totalAmountCents: 10000,
    netAmountCents: 9700,
    feeAmountCents: 300,
    refundAmountCents: 0,
    returnAmountCents: 0,
    disputeAmountCents: 0,
    transactionCount: 10,
    refundCount: 0,
    ...overrides,
  };
}

describe("computeSettlementBaseline", () => {
  it("returns null when there isn't enough history to trust an average", () => {
    const history = [snapshot(), snapshot(), snapshot()]; // 3, below the minimum of 4
    expect(computeSettlementBaseline(history)).toBeNull();
  });

  it("averages the history once there's enough of it", () => {
    const history = [
      snapshot({ totalAmountCents: 10000, refundAmountCents: 100, refundCount: 1, transactionCount: 10 }),
      snapshot({ totalAmountCents: 20000, refundAmountCents: 300, refundCount: 3, transactionCount: 20 }),
      snapshot({ totalAmountCents: 30000, refundAmountCents: 200, refundCount: 2, transactionCount: 30 }),
      snapshot({ totalAmountCents: 20000, refundAmountCents: 200, refundCount: 2, transactionCount: 20 }),
    ];
    const baseline = computeSettlementBaseline(history);
    expect(baseline).not.toBeNull();
    expect(baseline!.avgTotalAmountCents).toBe(20000);
    expect(baseline!.avgRefundAmountCents).toBe(200);
    expect(baseline!.avgRefundCount).toBe(2);
    expect(baseline!.avgTransactionCount).toBe(20);
    expect(baseline!.sampleSize).toBe(4);
  });
});

describe("evaluateSettlementRisk", () => {
  it("flags nothing for a clean settlement with no baseline", () => {
    expect(evaluateSettlementRisk(snapshot(), null)).toEqual([]);
  });

  it("flags a reconciliation mismatch beyond the rounding tolerance", () => {
    const flags = evaluateSettlementRisk(
      snapshot({ totalAmountCents: 10000, feeAmountCents: 300, netAmountCents: 5000 }), // calculated 9700 vs reported 5000
      null
    );
    expect(flags.map((f) => f.code)).toContain("RECONCILIATION_MISMATCH");
  });

  it("does not flag a reconciliation difference within the rounding tolerance", () => {
    const flags = evaluateSettlementRisk(
      snapshot({ totalAmountCents: 10000, feeAmountCents: 300, netAmountCents: 9699 }), // calculated 9700, off by 1 cent
      null
    );
    expect(flags.map((f) => f.code)).not.toContain("RECONCILIATION_MISMATCH");
  });

  it("flags a settlement with money but zero transactions, and vice versa", () => {
    const moneyNoTxns = evaluateSettlementRisk(snapshot({ totalAmountCents: 5000, transactionCount: 0 }), null);
    expect(moneyNoTxns.map((f) => f.code)).toContain("COUNT_TOTAL_INCONSISTENT");

    const txnsNoMoney = evaluateSettlementRisk(snapshot({ totalAmountCents: 0, transactionCount: 5, netAmountCents: 0, feeAmountCents: 0 }), null);
    expect(txnsNoMoney.map((f) => f.code)).toContain("COUNT_TOTAL_INCONSISTENT");
  });

  it("does not flag zero-activity settlements as inconsistent", () => {
    const flags = evaluateSettlementRisk(
      snapshot({ totalAmountCents: 0, transactionCount: 0, netAmountCents: 0, feeAmountCents: 0 }),
      null
    );
    expect(flags.map((f) => f.code)).not.toContain("COUNT_TOTAL_INCONSISTENT");
  });

  it("flags a total-amount spike against the merchant's own baseline", () => {
    const baseline = computeSettlementBaseline([snapshot(), snapshot(), snapshot(), snapshot()]); // avg total 10000
    const flags = evaluateSettlementRisk(
      snapshot({ totalAmountCents: 40000, netAmountCents: 38800, feeAmountCents: 1200 }), // >3x baseline, reconciles cleanly
      baseline
    );
    expect(flags.map((f) => f.code)).toContain("TOTAL_AMOUNT_SPIKE");
  });

  it("does not flag a settlement within normal range of its baseline", () => {
    const baseline = computeSettlementBaseline([snapshot(), snapshot(), snapshot(), snapshot()]); // avg total 10000
    const flags = evaluateSettlementRisk(snapshot({ totalAmountCents: 15000, netAmountCents: 14700, feeAmountCents: 300 }), baseline);
    expect(flags.map((f) => f.code)).not.toContain("TOTAL_AMOUNT_SPIKE");
  });

  it("flags a refund amount and refund count spike separately", () => {
    const baseline = computeSettlementBaseline([
      snapshot({ refundAmountCents: 100, refundCount: 1 }),
      snapshot({ refundAmountCents: 100, refundCount: 1 }),
      snapshot({ refundAmountCents: 100, refundCount: 1 }),
      snapshot({ refundAmountCents: 100, refundCount: 1 }),
    ]);
    const flags = evaluateSettlementRisk(
      snapshot({ refundAmountCents: 500, refundCount: 5, netAmountCents: 9200, feeAmountCents: 300 }),
      baseline
    );
    expect(flags.map((f) => f.code)).toContain("REFUND_AMOUNT_SPIKE");
    expect(flags.map((f) => f.code)).toContain("REFUND_COUNT_SPIKE");
  });
});
