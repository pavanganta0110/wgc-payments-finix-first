import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MOCKED CONTROL-FLOW TEST — Stage 2 Task 8, "REFUND CRASH TEST" (item
 * 11), at the sweep level. The underlying repair logic itself
 * (reconcileRefundRequest never creating a second reversal) is already
 * proven in src/lib/payments/__tests__/refundReconciliation.test.ts; this
 * file proves the sweep correctly orchestrates it on a batch and never
 * calls anything that could create a reversal — `finixClient` here
 * exposes only the read-only `listTransferReversals`, no
 * `createReversal`-shaped mock exists at all.
 */

const mockListTransferReversals = vi.fn();
vi.mock("@/lib/finix/client", () => ({ finixClient: { listTransferReversals: (...a: unknown[]) => mockListTransferReversals(...a) } }));
vi.mock("@/lib/finix/redact", () => ({ redactFinixPayload: (x: unknown) => x }));

const mockPrisma = {
  refundRequest: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  finixRefundOrReversal: { upsert: vi.fn().mockResolvedValue({}) },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../refundReconciliationSweep");
}

function stuckRefund(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "refund-1", churchId: "church-1", finixTransferId: "TR1", clientRefundId: "click-1", amountCents: 5000, status: "PENDING", finixReversalId: null, updatedAt: new Date(Date.now() - 20 * 60 * 1000), ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("reconcileStaleRefunds — the Refund Crash Test", () => {
  it("recovers a real Finix reversal for a RefundRequest left PENDING by a crash, marks it complete, and never creates a second reversal", async () => {
    mockPrisma.refundRequest.findMany.mockResolvedValue([stuckRefund()]);
    mockPrisma.refundRequest.findUnique.mockResolvedValue(stuckRefund());
    mockListTransferReversals.mockResolvedValue({
      _embedded: { reversals: [{ id: "REV_real", tags: { refundRequestId: "refund-1" }, amount: 5000, state: "SUCCEEDED", type: "REVERSAL" }] },
    });
    mockPrisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });

    const { reconcileStaleRefunds } = await load();
    const result = await reconcileStaleRefunds();

    expect(result.candidatesChecked).toBe(1);
    expect(result.outcomes.RECOVERED).toBe(1);
    // The one reversal Finix actually created is recorded — never a new one.
    expect(mockPrisma.refundRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED", finixReversalId: "REV_real" }) })
    );
  });

  it("marks FAILED (not a retry, not a second reversal attempt) when Finix genuinely has no matching reversal", async () => {
    mockPrisma.refundRequest.findMany.mockResolvedValue([stuckRefund()]);
    mockPrisma.refundRequest.findUnique.mockResolvedValue(stuckRefund());
    mockListTransferReversals.mockResolvedValue({ _embedded: { reversals: [] } });
    mockPrisma.refundRequest.updateMany.mockResolvedValue({ count: 1 });

    const { reconcileStaleRefunds } = await load();
    const result = await reconcileStaleRefunds();

    expect(result.outcomes.NOT_FOUND).toBe(1);
  });

  it("an unexpected error reading a candidate (e.g. a DB blip on the initial lookup, before reconcileRefundRequest's own try/catch begins) is caught per-item, so one bad row never aborts the rest of the batch", async () => {
    mockPrisma.refundRequest.findMany.mockResolvedValue([stuckRefund(), stuckRefund({ id: "refund-2" })]);
    mockPrisma.refundRequest.findUnique.mockImplementation(async () => {
      throw new Error("boom");
    });

    const { reconcileStaleRefunds } = await load();
    const result = await reconcileStaleRefunds();

    expect(result.candidatesChecked).toBe(2);
    expect(result.outcomes.PERMANENT_ERROR).toBe(2);
  });

  it("a genuine reconciliation-attempt failure (Finix API error) is classified RETRYABLE_ERROR, worth retrying next sweep", async () => {
    mockPrisma.refundRequest.findMany.mockResolvedValue([stuckRefund()]);
    mockPrisma.refundRequest.findUnique.mockResolvedValue(stuckRefund());
    mockListTransferReversals.mockRejectedValue(new Error("Finix API timeout"));

    const { reconcileStaleRefunds } = await load();
    const result = await reconcileStaleRefunds();

    expect(result.outcomes.RETRYABLE_ERROR).toBe(1);
  });

  it("bounds the scan (never a full-table read)", async () => {
    mockPrisma.refundRequest.findMany.mockResolvedValue([]);
    const { reconcileStaleRefunds } = await load();
    await reconcileStaleRefunds(20);
    expect(mockPrisma.refundRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });
});
