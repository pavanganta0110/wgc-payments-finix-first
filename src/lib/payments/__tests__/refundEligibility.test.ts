import { describe, it, expect } from "vitest";
import { checkRefundEligibility } from "../refundEligibility";

const CHURCH_ID = "church_1";

function makeTransfer(overrides: Partial<Record<string, any>> = {}) {
  return {
    churchId: CHURCH_ID,
    type: "TRANSFER",
    state: "SUCCEEDED",
    amountCents: 10000,
    ...overrides,
  } as any;
}

describe("checkRefundEligibility remaining balance", () => {
  it("returns the full amount as remainingCents when nothing has been refunded yet", () => {
    const result = checkRefundEligibility(makeTransfer(), [], [], CHURCH_ID);
    expect(result.eligible).toBe(true);
    expect(result.remainingCents).toBe(10000);
  });

  it("subtracts a prior SUCCEEDED partial refund from remainingCents", () => {
    const refunds = [{ state: "SUCCEEDED", amountCents: 4000 }] as any;
    const result = checkRefundEligibility(makeTransfer(), refunds, [], CHURCH_ID);
    expect(result.eligible).toBe(true);
    expect(result.remainingCents).toBe(6000);
  });

  it("also counts a PENDING refund against remainingCents, not just SUCCEEDED", () => {
    const refunds = [{ state: "PENDING", amountCents: 3000 }] as any;
    const result = checkRefundEligibility(makeTransfer(), refunds, [], CHURCH_ID);
    expect(result.eligible).toBe(true);
    expect(result.remainingCents).toBe(7000);
  });

  it("is ineligible with no remainingCents once fully refunded", () => {
    const refunds = [{ state: "SUCCEEDED", amountCents: 10000 }] as any;
    const result = checkRefundEligibility(makeTransfer(), refunds, [], CHURCH_ID);
    expect(result.eligible).toBe(false);
    expect(result.remainingCents).toBeUndefined();
  });

  it("reflects two prior partial refunds cumulatively, guarding against a second refund reusing the original amount", () => {
    const refunds = [
      { state: "SUCCEEDED", amountCents: 6000 },
      { state: "SUCCEEDED", amountCents: 2000 },
    ] as any;
    const result = checkRefundEligibility(makeTransfer(), refunds, [], CHURCH_ID);
    expect(result.eligible).toBe(true);
    // Only $20.00 left, not the original $100.00 — this is the exact value
    // the refund route now bounds a new refund request against.
    expect(result.remainingCents).toBe(2000);
  });

  // reservedPendingCents (PRIORITY 7): the actual fix for "two admins
  // refund the same available balance." The refund route computes this
  // from OTHER RefundRequest rows currently PENDING for this transfer
  // (claimed but not yet confirmed with Finix) inside the same row-locked
  // transaction that creates a new claim — so the second admin's request
  // never sees the pre-reservation balance, even though no
  // FinixRefundOrReversal row exists for the first refund yet.
  describe("reservedPendingCents — concurrent different-intent refund claims", () => {
    it("reduces remainingCents by another admin's already-claimed (but not yet Finix-confirmed) refund amount", () => {
      // $100 transfer, nothing SUCCEEDED yet, but $60 is already claimed by
      // a different in-flight RefundRequest (a different admin/intent).
      const result = checkRefundEligibility(makeTransfer(), [], [], CHURCH_ID, 6000);
      expect(result.eligible).toBe(true);
      expect(result.remainingCents).toBe(4000);
    });

    it("makes a transfer ineligible once pending claims alone reach the full amount, even with zero completed refunds", () => {
      const result = checkRefundEligibility(makeTransfer(), [], [], CHURCH_ID, 10000);
      expect(result.eligible).toBe(false);
      expect(result.remainingCents).toBeUndefined();
    });

    it("combines completed refunds AND a concurrent pending claim — the two admins scenario end to end", () => {
      // $100 transfer: $20 already refunded and confirmed, a second
      // request for $50 is currently claimed-but-unconfirmed. A third
      // request must only see $30 remaining, not $80.
      const refunds = [{ state: "SUCCEEDED", amountCents: 2000 }] as any;
      const result = checkRefundEligibility(makeTransfer(), refunds, [], CHURCH_ID, 5000);
      expect(result.eligible).toBe(true);
      expect(result.remainingCents).toBe(3000);
    });

    it("defaults to 0 (today's unchanged behavior) when the caller omits reservedPendingCents", () => {
      const result = checkRefundEligibility(makeTransfer(), [], [], CHURCH_ID);
      expect(result.remainingCents).toBe(10000);
    });
  });
});
