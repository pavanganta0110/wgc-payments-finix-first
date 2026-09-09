import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

function makeP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.16.1" });
}

const mockQueryRaw = vi.fn();
const mockFinixTransferFindFirst = vi.fn();
const mockRefundFindMany = vi.fn();
const mockBankReturnFindMany = vi.fn();
const mockPendingRequestsFindMany = vi.fn();
const mockPaymentFindFirst = vi.fn();
const mockRefundRequestCreate = vi.fn();
const mockRefundRequestFindUnique = vi.fn();
const mockRefundRequestUpdate = vi.fn();
const mockFinixRefundUpsert = vi.fn();
const mockLogDashboardAction = vi.fn();
const mockCreateTransferReversal = vi.fn();

const tx = {
  $queryRaw: (...a: unknown[]) => mockQueryRaw(...a),
  finixTransfer: { findFirst: (...a: unknown[]) => mockFinixTransferFindFirst(...a) },
  finixRefundOrReversal: { findMany: (...a: unknown[]) => mockRefundFindMany(...a) },
  bankReturn: { findMany: (...a: unknown[]) => mockBankReturnFindMany(...a) },
  refundRequest: {
    findMany: (...a: unknown[]) => mockPendingRequestsFindMany(...a),
    create: (...a: unknown[]) => mockRefundRequestCreate(...a),
    findUnique: (...a: unknown[]) => mockRefundRequestFindUnique(...a),
  },
  payment: { findFirst: (...a: unknown[]) => mockPaymentFindFirst(...a) },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: vi.fn(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (t: typeof tx) => unknown)(tx);
    }),
    refundRequest: { update: (...a: unknown[]) => mockRefundRequestUpdate(...a) },
    finixRefundOrReversal: { upsert: (...a: unknown[]) => mockFinixRefundUpsert(...a) },
    // The route now looks up the originating Payment row outside the
    // locked transaction (to pass originalPaymentId into the shared
    // claimRefundRequestWithBalanceLock() call) — same mock function the
    // transaction previously used via tx.payment, now also reachable at
    // the top level.
    payment: { findFirst: (...a: unknown[]) => mockPaymentFindFirst(...a) },
  },
}));

vi.mock("@/lib/finix/client", () => ({
  finixClient: { createTransferReversal: (...a: unknown[]) => mockCreateTransferReversal(...a) },
}));
vi.mock("@/lib/finix/redact", () => ({ redactFinixPayload: (x: unknown) => x }));
vi.mock("@/lib/dashboardAudit", () => ({ logDashboardAction: (...a: unknown[]) => mockLogDashboardAction(...a) }));
vi.mock("@/lib/auth/auditImpersonatedWrite", () => ({ auditImpersonatedWrite: vi.fn() }));
vi.mock("@/lib/auth/errors", () => ({ isAuthError: () => false }));
vi.mock("@/lib/auth/permissions", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/auth/viewScope", () => ({ requireFullOrganizationContext: vi.fn() }));

const mockRequireMerchantSession = vi.fn();
vi.mock("@/lib/auth/requireMerchantSession", () => ({ requireMerchantSession: () => mockRequireMerchantSession() }));

const AUTH = { userId: "admin-1", email: "admin@church.org", rawRole: "owner", churchId: "church-A" };

function makeReq(body: unknown) {
  return new Request("https://x", { method: "POST", body: JSON.stringify(body) });
}

function setupEligibleTransfer(overrides: { pendingReserved?: { clientRefundId: string; amountCents: number }[] } = {}) {
  mockQueryRaw.mockResolvedValue([{ id: "finix-transfer-row-1" }]);
  mockFinixTransferFindFirst.mockResolvedValue({ finixTransferId: "TR1", churchId: "church-A", type: "TRANSFER", state: "SUCCEEDED", amountCents: 10000, finixMerchantId: "MU1" });
  mockRefundFindMany.mockResolvedValue([]);
  mockBankReturnFindMany.mockResolvedValue([]);
  mockPendingRequestsFindMany.mockResolvedValue(overrides.pendingReserved ?? []);
  mockPaymentFindFirst.mockResolvedValue({ id: "payment-1" });
}

describe("POST /refund — PRIORITY 7/8: one refund intent -> at most one Finix reversal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchantSession.mockResolvedValue(AUTH);
    mockRefundRequestUpdate.mockResolvedValue({});
    mockFinixRefundUpsert.mockResolvedValue({});
    mockLogDashboardAction.mockResolvedValue(undefined);
  });

  it("a fresh claim calls Finix exactly once with a stable idempotency_id derived from the claimed RefundRequest row", async () => {
    setupEligibleTransfer();
    mockRefundRequestCreate.mockResolvedValue({ id: "refund-req-1", amountCents: 5000, clientRefundId: "click-1" });
    mockCreateTransferReversal.mockResolvedValue({ id: "REV1", state: "PENDING", amount: 5000, currency: "USD" });

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "click-1" }), { params: Promise.resolve({ transferId: "TR1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reversalId).toBe("REV1");
    expect(mockCreateTransferReversal).toHaveBeenCalledTimes(1);
    expect(mockCreateTransferReversal).toHaveBeenCalledWith("TR1", expect.objectContaining({ idempotency_id: "refund:refund-req-1" }));
    expect(mockRefundRequestUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "refund-req-1" }, data: { status: "SUCCEEDED", finixReversalId: "REV1" } }));
  });

  it("PRIORITY 7/reconciliation: the outgoing Finix reversal request carries tags.refundRequestId set to the exact persisted RefundRequest id — this is what refundReconciliation.ts later matches on, never amount/timing/donor", async () => {
    setupEligibleTransfer();
    mockRefundRequestCreate.mockResolvedValue({ id: "refund-req-reconcile-check", amountCents: 5000, clientRefundId: "click-1" });
    mockCreateTransferReversal.mockResolvedValue({ id: "REV1", state: "PENDING", amount: 5000, currency: "USD" });

    const { POST } = await import("../route");
    await POST(makeReq({ amountCents: 5000, clientRefundId: "click-1" }), { params: Promise.resolve({ transferId: "TR1" }) });

    expect(mockCreateTransferReversal).toHaveBeenCalledWith(
      "TR1",
      expect.objectContaining({ tags: expect.objectContaining({ refundRequestId: "refund-req-reconcile-check" }) })
    );
  });

  it("double-click with the SAME clientRefundId: the second request never calls Finix, returns the first reversal as a duplicate", async () => {
    setupEligibleTransfer();
    // First call's create wins the unique-constraint race.
    mockRefundRequestCreate.mockRejectedValueOnce(makeP2002());
    // The second request re-fetches the row the first request already
    // completed (SUCCEEDED with a real reversal id).
    mockRefundRequestFindUnique.mockResolvedValue({ id: "refund-req-1", status: "SUCCEEDED", finixReversalId: "REV1" });

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "click-1" }), { params: Promise.resolve({ transferId: "TR1" }) });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.duplicate).toBe(true);
    expect(data.reversalId).toBe("REV1");
    expect(mockCreateTransferReversal).not.toHaveBeenCalled();
  });

  it("double-click while the FIRST request is still PENDING (genuinely concurrent, or left ambiguous by a timeout): refused with 409, never fires Finix", async () => {
    setupEligibleTransfer();
    mockRefundRequestCreate.mockRejectedValueOnce(makeP2002());
    mockRefundRequestFindUnique.mockResolvedValue({ id: "refund-req-1", status: "PENDING", finixReversalId: null });

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "click-1" }), { params: Promise.resolve({ transferId: "TR1" }) });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.code).toBe("REFUND_STATUS_UNCERTAIN");
    expect(mockCreateTransferReversal).not.toHaveBeenCalled();
  });

  it("two admins, two DIFFERENT clientRefundIds, overlapping amounts: the second is rejected once the first has reserved the balance", async () => {
    // First admin's $60 request is already PENDING (claimed, not yet
    // Finix-confirmed) when the second admin's $50 request runs its own
    // short locked transaction — the reserved amount from the first
    // request must reduce what the second sees as available.
    setupEligibleTransfer({ pendingReserved: [{ clientRefundId: "admin-1-click", amountCents: 6000 }] });

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "admin-2-click" }), { params: Promise.resolve({ transferId: "TR1" }) });

    expect(res.status).toBe(400);
    expect(mockRefundRequestCreate).not.toHaveBeenCalled();
    expect(mockCreateTransferReversal).not.toHaveBeenCalled();
  });

  it("an ambiguous Finix failure (timeout) leaves the claim PENDING, not FAILED, and reports uncertain rather than a hard failure", async () => {
    setupEligibleTransfer();
    mockRefundRequestCreate.mockResolvedValue({ id: "refund-req-2", amountCents: 5000, clientRefundId: "click-2" });
    mockCreateTransferReversal.mockRejectedValue(new Error("Request timed out"));

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "click-2" }), { params: Promise.resolve({ transferId: "TR1" }) });
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe("REFUND_STATUS_UNCERTAIN");
    expect(mockRefundRequestUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "refund-req-2" }, data: expect.not.objectContaining({ status: "FAILED" }) }));
  });

  it("a clear Finix rejection marks the claim FAILED (not PENDING), so a NEW clientRefundId retry is allowed", async () => {
    setupEligibleTransfer();
    mockRefundRequestCreate.mockResolvedValue({ id: "refund-req-3", amountCents: 5000, clientRefundId: "click-3" });
    mockCreateTransferReversal.mockRejectedValue(new Error("Reversal amount exceeds available balance"));

    const { POST } = await import("../route");
    const res = await POST(makeReq({ amountCents: 5000, clientRefundId: "click-3" }), { params: Promise.resolve({ transferId: "TR1" }) });

    expect(res.status).toBe(400);
    expect(mockRefundRequestUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "refund-req-3" }, data: expect.objectContaining({ status: "FAILED" }) }));
  });
});
