import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MOCKED CONTROL-FLOW TESTS — Stage 2 Task 8, payment reconciliation.
 *
 * REQUIRED "PAYMENT ORPHAN TEST" (Task 8, item 10): Finix success fixture
 * exists, local Payment write is missing, the reconciler runs. Expected:
 * original transfer recovered, exactly one Payment, and — the critical
 * proof — the reconciler is structurally incapable of initiating a new
 * charge. `finixClient` here only exposes read-only lookups
 * (getTransfer/findTransferByIdempotencyId/listTransferReversals); there
 * is no `createTransfer` mock at all, so if the sweep or anything it calls
 * ever tried to charge Finix, this test would fail with a "not a
 * function" error rather than silently succeeding — the absence of that
 * mock IS the proof, not an assertion that could be forgotten.
 */

const mockFindTransferByIdempotencyId = vi.fn();
const mockGetTransfer = vi.fn();
vi.mock("@/lib/finix/client", () => ({
  finixClient: {
    findTransferByIdempotencyId: (...a: unknown[]) => mockFindTransferByIdempotencyId(...a),
    getTransfer: (...a: unknown[]) => mockGetTransfer(...a),
    // Deliberately no createTransfer — see file doc comment above.
  },
}));
vi.mock("@/lib/finix/redact", () => ({ redactFinixPayload: (x: unknown) => x }));
vi.mock("@/lib/finix/sync/syncFees", () => ({ syncFeesForTransfer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/email", () => ({ sendWgcAdminEmail: vi.fn().mockResolvedValue(undefined) }));

const mockPrisma = {
  paymentAttempt: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  payment: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  givingLink: { findFirst: vi.fn(), update: vi.fn() },
  church: { findUnique: vi.fn() },
  finixTransfer: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../paymentReconciliationSweep");
}

const STUCK_ATTEMPT = {
  id: "attempt-1",
  churchId: "church-1",
  idempotencyId: "idem-1",
  totalCents: 5000,
  status: "PROCESSING",
  updatedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago, past the 15-min threshold
  failureMessage: null,
};

beforeEach(() => vi.clearAllMocks());

describe("reconcileStalePaymentAttempts — the Payment Orphan Test", () => {
  it("recovers a Finix-confirmed transfer with no local Payment: exactly one Payment created, no createTransfer call possible", async () => {
    mockPrisma.paymentAttempt.findMany.mockResolvedValue([STUCK_ATTEMPT]);
    mockFindTransferByIdempotencyId.mockResolvedValue({
      id: "TR-orphan-1",
      state: "SUCCEEDED",
      amount: 5000,
      tags: {},
      merchant_identity: "ID1",
      source: "PI1",
    });
    mockPrisma.payment.findFirst.mockResolvedValue(null); // no Payment exists yet — the gap
    mockPrisma.paymentAttempt.findUnique.mockResolvedValue(null); // no matching PaymentAttempt by idempotencyId inside recoverOrphanedOneTimePayment (already consumed via findMany above)
    mockPrisma.payment.create.mockResolvedValue({ id: "payment-recovered-1", status: "SUCCEEDED", amountCents: 5000 });

    const { reconcileStalePaymentAttempts } = await load();
    const result = await reconcileStalePaymentAttempts();

    expect(result.candidatesChecked).toBe(1);
    expect(result.outcomes.RECOVERED).toBe(1);
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finixTransferId: "TR-orphan-1", status: "SUCCEEDED" }) })
    );
    // Required downstream jobs enqueued transactionally alongside the
    // Payment create, per Task 8 item 3 — never a direct, non-durable call.
    const jobCalls = mockPrisma.backgroundJob.create.mock.calls.map((c) => c[0].data.jobType);
    expect(jobCalls).toContain("SEND_RECEIPT");
    expect(jobCalls).toContain("QUICKBOOKS_PAYMENT");
  });

  it("leaves a not-yet-terminal transfer STILL_UNCERTAIN rather than guessing at an outcome", async () => {
    mockPrisma.paymentAttempt.findMany.mockResolvedValue([STUCK_ATTEMPT]);
    mockFindTransferByIdempotencyId.mockResolvedValue({ id: "TR-pending-1", state: "PROCESSING", amount: 5000, tags: {} });
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.paymentAttempt.findUnique.mockResolvedValue(null);

    const { reconcileStalePaymentAttempts } = await load();
    const result = await reconcileStalePaymentAttempts();

    expect(result.outcomes.STILL_UNCERTAIN).toBe(1);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("closes out a genuinely abandoned attempt (no Finix transfer after 1 hour) without ever touching Finix again", async () => {
    mockPrisma.paymentAttempt.findMany.mockResolvedValue([
      { ...STUCK_ATTEMPT, updatedAt: new Date(Date.now() - 90 * 60 * 1000) },
    ]);
    mockFindTransferByIdempotencyId.mockResolvedValue(null);

    const { reconcileStalePaymentAttempts } = await load();
    const result = await reconcileStalePaymentAttempts();

    expect(result.abandonedClosed).toBe(1);
    expect(result.outcomes.NOT_FOUND).toBe(1);
    expect(mockPrisma.paymentAttempt.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("a Payment that already exists (recovered by a concurrent webhook/checkout) is ALREADY_RESOLVED, never a second Payment", async () => {
    mockPrisma.paymentAttempt.findMany.mockResolvedValue([STUCK_ATTEMPT]);
    mockFindTransferByIdempotencyId.mockResolvedValue({ id: "TR-raced-1", state: "SUCCEEDED", amount: 5000 });
    mockPrisma.payment.findFirst.mockResolvedValue({ id: "payment-already-there", status: "SUCCEEDED" });

    const { reconcileStalePaymentAttempts } = await load();
    const result = await reconcileStalePaymentAttempts();

    expect(result.outcomes.ALREADY_RESOLVED).toBe(1);
    expect(mockPrisma.payment.create).not.toHaveBeenCalled();
  });

  it("does nothing when there are no stale candidates (bounded scan, not a full-table sweep)", async () => {
    mockPrisma.paymentAttempt.findMany.mockResolvedValue([]);
    const { reconcileStalePaymentAttempts } = await load();
    const result = await reconcileStalePaymentAttempts();
    expect(result.candidatesChecked).toBe(0);
    expect(mockFindTransferByIdempotencyId).not.toHaveBeenCalled();
  });
});

describe("reconcileStaleTransfers — global bounded scan of stuck-PENDING transfers", () => {
  it("re-checks a stale PENDING transfer against Finix and applies the real state via the existing shouldApplyTransferState-guarded path", async () => {
    mockPrisma.finixTransfer.findMany.mockResolvedValue([{ finixTransferId: "TR-stale-1" }]);
    mockPrisma.finixTransfer.findUnique.mockResolvedValue({ finixTransferId: "TR-stale-1", state: "PENDING", churchId: "church-1", failureCode: null, failureMessage: null, updatedAtFinix: null });
    mockGetTransfer.mockResolvedValue({ id: "TR-stale-1", state: "SUCCEEDED" });
    mockPrisma.finixTransfer.update.mockResolvedValue({});
    mockPrisma.payment.findFirst.mockResolvedValue(null);

    const { reconcileStaleTransfers } = await load();
    const result = await reconcileStaleTransfers();

    expect(result.candidatesChecked).toBe(1);
    expect(result.outcomes.RECOVERED).toBe(1);
    expect(mockGetTransfer).toHaveBeenCalledWith("TR-stale-1");
  });

  it("bounds the scan with `limit` (a huge unresolved backlog never becomes an unbounded query)", async () => {
    mockPrisma.finixTransfer.findMany.mockResolvedValue([]);
    const { reconcileStaleTransfers } = await load();
    await reconcileStaleTransfers(25);
    expect(mockPrisma.finixTransfer.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 25 }));
  });
});
