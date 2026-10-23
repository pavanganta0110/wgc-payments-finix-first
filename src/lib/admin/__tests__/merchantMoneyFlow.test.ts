import { describe, it, expect, vi } from "vitest";

// $queryRaw call order inside loadMerchantMoneyFlow: charges, fees, deposits.
const rawResults: unknown[][] = [
  [
    { church_id: "a", amount: BigInt(498774), count: BigInt(33) },
    { church_id: "b", amount: BigInt(1000), count: BigInt(1) },
  ],
  [
    { church_id: "a", fees: 15385.6, donor_covered: 13897.4 },
    { church_id: "b", fees: 50, donor_covered: null },
  ],
  [
    { church_id: "a", amount: BigInt(481700), count: BigInt(31) },
    { church_id: "b", amount: BigInt(1050), count: BigInt(2) },
  ],
];
let rawCall = 0;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async () => rawResults[rawCall++]),
    finixRefundOrReversal: { groupBy: vi.fn().mockResolvedValue([{ churchId: "a", _sum: { amountCents: 500 } }]) },
    bankReturn: { groupBy: vi.fn().mockResolvedValue([{ churchId: "a", _sum: { amountCents: 250 } }]) },
    church: { findMany: vi.fn().mockResolvedValue([{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }]) },
  },
}));

describe("loadMerchantMoneyFlow", () => {
  it("lines up collected, fees, refunds and deposits per merchant and totals them", async () => {
    const { loadMerchantMoneyFlow } = await import("@/lib/admin/merchantMoneyFlow");
    const { resolveAdminPeriod } = await import("@/lib/admin/platformMetrics");
    const flow = await loadMerchantMoneyFlow(resolveAdminPeriod("ytd", new Date("2026-10-23T12:00:00Z")));

    const a = flow.rows.find((r) => r.churchId === "a")!;
    expect(a).toMatchObject({
      name: "Alpha",
      collectedCents: 498774,
      paymentCount: 33,
      feesCents: 15386, // rounded once per merchant, not per fee row
      donorCoveredFeesCents: 13897,
      refundedCents: 750, // refund 500 + ACH return 250
      depositedCents: 481700,
      depositCount: 31,
    });
    // 498774 − 750 − 15386 − 481700 = 938 still in flight
    expect(a.awaitingDepositCents).toBe(938);

    // Beta was deposited more than expected (1000 − 50 = 950 vs 1050): shown negative, not hidden.
    const b = flow.rows.find((r) => r.churchId === "b")!;
    expect(b.awaitingDepositCents).toBe(-100);

    expect(flow.rows.map((r) => r.churchId)).toEqual(["a", "b"]); // biggest collector first
    expect(flow.totals.collectedCents).toBe(499774);
    expect(flow.totals.depositedCents).toBe(482750);
    expect(flow.totals.awaitingDepositCents).toBe(a.awaitingDepositCents + b.awaitingDepositCents);
  });
});
