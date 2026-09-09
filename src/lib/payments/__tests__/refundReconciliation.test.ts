import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindUnique = vi.fn();
const mockUpdateMany = vi.fn();
const mockFinixRefundUpsert = vi.fn();
const mockTransaction = vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
const mockListTransferReversals = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    refundRequest: { findUnique: (...a: unknown[]) => mockFindUnique(...a), updateMany: (...a: unknown[]) => mockUpdateMany(...a) },
    finixRefundOrReversal: { upsert: (...a: unknown[]) => mockFinixRefundUpsert(...a) },
    $transaction: (...a: unknown[]) => mockTransaction(a[0] as unknown[]),
  },
}));
vi.mock("@/lib/finix/client", () => ({ finixClient: { listTransferReversals: (...a: unknown[]) => mockListTransferReversals(...a) } }));
vi.mock("@/lib/finix/redact", () => ({ redactFinixPayload: (x: unknown) => x }));

function pendingRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "req-1",
    churchId: "church-a",
    finixTransferId: "TR1",
    clientRefundId: "click-1",
    amountCents: 5000,
    status: "PENDING",
    finixReversalId: null,
    ...overrides,
  };
}

describe("reconcileRefundRequest — PRIORITY 7/8 follow-up: recover the true Finix result, never create a second reversal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never calls Finix at all for a RefundRequest that isn't PENDING — already-resolved rows are returned as-is", async () => {
    const { reconcileRefundRequest } = await import("../refundReconciliation");
    mockFindUnique.mockResolvedValue(pendingRequest({ status: "SUCCEEDED", finixReversalId: "REV_existing" }));

    const result = await reconcileRefundRequest("req-1");

    expect(result).toEqual({ outcome: "reconciled_succeeded", finixReversalId: "REV_existing" });
    expect(mockListTransferReversals).not.toHaveBeenCalled();
  });

  it("matches the real reversal by tags.refundRequestId — never by amount or timing — and records it, without creating a new one", async () => {
    const { reconcileRefundRequest } = await import("../refundReconciliation");
    mockFindUnique.mockResolvedValue(pendingRequest());
    mockListTransferReversals.mockResolvedValue({
      _embedded: {
        reversals: [
          { id: "REV_unrelated", tags: { refundRequestId: "some-other-request" }, amount: 5000, state: "SUCCEEDED" },
          { id: "REV_match", tags: { refundRequestId: "req-1" }, amount: 5000, state: "SUCCEEDED", type: "REVERSAL" },
        ],
      },
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await reconcileRefundRequest("req-1");

    expect(result).toEqual({ outcome: "reconciled_succeeded", finixReversalId: "REV_match" });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "req-1", status: "PENDING" }, data: expect.objectContaining({ status: "SUCCEEDED", finixReversalId: "REV_match" }) }));
    // The invariant this whole module exists to prove: reconciliation reads
    // Finix's existing reversal list, it never creates one.
    expect(mockFinixRefundUpsert).toHaveBeenCalledTimes(1);
  });

  it("marks FAILED (never retries Finix itself) when no matching reversal exists at Finix at all", async () => {
    const { reconcileRefundRequest } = await import("../refundReconciliation");
    mockFindUnique.mockResolvedValue(pendingRequest());
    mockListTransferReversals.mockResolvedValue({ _embedded: { reversals: [] } });
    mockUpdateMany.mockResolvedValue({ count: 1 });

    const result = await reconcileRefundRequest("req-1");

    expect(result).toEqual({ outcome: "reconciled_failed" });
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }));
  });

  it("two concurrent reconciliation passes: the second sees zero rows updated (already resolved) and reports still_unknown rather than re-processing", async () => {
    const { reconcileRefundRequest } = await import("../refundReconciliation");
    mockFindUnique.mockResolvedValue(pendingRequest());
    mockListTransferReversals.mockResolvedValue({ _embedded: { reversals: [] } });
    // Simulates another concurrent reconciler having already flipped this
    // row's status out of PENDING between our findUnique read and this
    // conditional update.
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await reconcileRefundRequest("req-1");

    expect(result).toEqual({ outcome: "still_unknown" });
  });
});
