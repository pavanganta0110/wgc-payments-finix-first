import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/requireMerchantSession", () => ({ requireMerchantSession: () => mockAuth() }));
vi.mock("@/lib/dashboardAudit", () => ({ logDashboardAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/invoices/invoiceEmails", () => ({ sendInvoicePaymentReceiptEmail: vi.fn().mockResolvedValue(undefined) }));

const mockFinixClient = { createTransferReversal: vi.fn() };
vi.mock("@/lib/finix/client", () => ({ finixClient: mockFinixClient }));
vi.mock("@/lib/finix/redact", () => ({ redactFinixPayload: (x: unknown) => x }));

const mockPrisma = {
  invoice: { findFirst: vi.fn(), update: vi.fn() },
  invoicePayment: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  invoiceActivity: { create: vi.fn() },
  finixRefundOrReversal: { upsert: vi.fn(), findMany: vi.fn() },
  // The refund route now claims its RefundRequest via the SAME shared
  // claimRefundRequestWithBalanceLock() the transactions/payments refund
  // route uses (see cold-review defect #3 / refundRequestClaim.ts) — that
  // function locks and re-reads FinixTransfer/refunds/bankReturns/pending
  // RefundRequests inside its own $transaction, so this mock needs those
  // too, not just refundRequest.create/update/findUnique.
  refundRequest: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  finixTransfer: { findFirst: vi.fn() },
  bankReturn: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

function ownerAuth(churchId = "church-a") {
  return { userId: "u1", email: "owner@a.com", churchId, role: "owner", rawRole: "owner" };
}
function viewerAuth(churchId = "church-a") {
  return { userId: "u3", email: "viewer@a.com", churchId, role: "viewer", rawRole: "viewer" };
}

function baseInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv1",
    churchId: "church-a",
    status: "SENT",
    totalCents: 10000,
    dueDate: new Date("2026-12-01"),
    firstViewedAt: null,
    paidAt: null,
    currency: "USD",
    ...overrides,
  };
}

function req(body: unknown) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

async function loadOfflinePayment() {
  vi.resetModules();
  return import("@/app/api/merchant/invoices/[invoiceId]/record-offline-payment/route");
}
async function loadRefund() {
  vi.resetModules();
  return import("@/app/api/merchant/invoices/[invoiceId]/payments/[paymentId]/refund/route");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.$transaction.mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") {
      return (fn as (tx: typeof mockPrisma) => unknown)(mockPrisma);
    }
    return Promise.all(fn as Promise<unknown>[]);
  });
  // Default: a fresh RefundRequest claim succeeds (the common case for
  // every existing test below, none of which are specifically testing
  // double-click/duplicate-claim behavior — that's covered separately in
  // the transactions/payments refund route's own test file and in this
  // file's own concurrency describe block below).
  mockPrisma.refundRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "refund-req-test",
    ...data,
  }));
  mockPrisma.$queryRaw.mockResolvedValue([{ id: "finix-transfer-row-1" }]);
  mockPrisma.finixTransfer.findFirst.mockResolvedValue({ finixTransferId: "TR123", churchId: "church-a", type: "TRANSFER", state: "SUCCEEDED", amountCents: 5000, finixMerchantId: "MU1" });
  mockPrisma.finixRefundOrReversal.findMany.mockResolvedValue([]);
  mockPrisma.bankReturn.findMany.mockResolvedValue([]);
  mockPrisma.refundRequest.findMany.mockResolvedValue([]);
});

describe("POST /api/merchant/invoices/[invoiceId]/record-offline-payment", () => {
  it("requires canRecordOfflineInvoicePayments", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(viewerAuth());
    const res = await POST(req({ amountCents: 5000, method: "CASH" }), { params: Promise.resolve({ invoiceId: "inv1" }) });
    expect(res.status).toBe(403);
  });

  it("rejects an amount exceeding the remaining balance — blocks overpayment rather than capping it", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findMany.mockResolvedValue([]);

    const res = await POST(req({ amountCents: 20000, method: "CASH" }), { params: Promise.resolve({ invoiceId: "inv1" }) });
    expect(res.status).toBe(400);
    expect(mockPrisma.invoicePayment.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid payment method", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findMany.mockResolvedValue([]);

    const res = await POST(req({ amountCents: 5000, method: "BITCOIN" }), { params: Promise.resolve({ invoiceId: "inv1" }) });
    expect(res.status).toBe(400);
  });

  it("rejects a payment against an invoice that cannot accept payment (e.g. VOID)", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice({ status: "VOID" }));

    const res = await POST(req({ amountCents: 5000, method: "CASH" }), { params: Promise.resolve({ invoiceId: "inv1" }) });
    expect(res.status).toBe(409);
  });

  it("records a valid partial payment, reduces the balance, and derives PARTIALLY_PAID status", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findMany.mockResolvedValue([]);
    mockPrisma.invoicePayment.create.mockResolvedValue({ id: "pay1" });

    const res = await POST(
      req({ amountCents: 4000, method: "CHECK", offlinePaymentDate: "2026-11-01", offlineReferenceNumber: "1234" }),
      { params: Promise.resolve({ invoiceId: "inv1" }) }
    );
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe("PARTIALLY_PAID");
    expect(data.balanceCents).toBe(6000);
    expect(mockPrisma.invoicePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: "OFFLINE", method: "CHECK", grossAmountCents: 4000, status: "SUCCEEDED" }) })
    );
  });

  it("derives PAID status and sets paidAt when a payment brings the balance to exactly zero", async () => {
    const { POST } = await loadOfflinePayment();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findMany.mockResolvedValue([]);
    mockPrisma.invoicePayment.create.mockResolvedValue({ id: "pay1" });

    const res = await POST(req({ amountCents: 10000, method: "CASH" }), { params: Promise.resolve({ invoiceId: "inv1" }) });
    const data = await res.json();
    expect(data.status).toBe("PAID");
    expect(data.balanceCents).toBe(0);
  });
});

describe("POST /api/merchant/invoices/[invoiceId]/payments/[paymentId]/refund", () => {
  const refundParams = { params: Promise.resolve({ invoiceId: "inv1", paymentId: "pay1" }) };

  it("requires canRefundInvoicePayments", async () => {
    const { POST } = await loadRefund();
    mockAuth.mockResolvedValue(viewerAuth());
    const res = await POST(req({}), refundParams);
    expect(res.status).toBe(403);
  });

  it("rejects refunding a payment that isn't SUCCEEDED/PARTIALLY_REFUNDED", async () => {
    const { POST } = await loadRefund();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findFirst.mockResolvedValue({ id: "pay1", status: "FAILED", grossAmountCents: 5000, refundedCents: 0, source: "OFFLINE" });

    const res = await POST(req({}), refundParams);
    expect(res.status).toBe(400);
  });

  it("rejects a refund amount exceeding what's still refundable", async () => {
    const { POST } = await loadRefund();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findFirst.mockResolvedValue({ id: "pay1", status: "SUCCEEDED", grossAmountCents: 5000, refundedCents: 1000, source: "OFFLINE" });

    const res = await POST(req({ amountCents: 5000 }), refundParams);
    expect(res.status).toBe(400);
  });

  it("applies an OFFLINE refund immediately (no processor call) and recomputes the invoice balance", async () => {
    const { POST } = await loadRefund();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice({ amountPaidCents: 5000, balanceCents: 5000 }));
    mockPrisma.invoicePayment.findFirst.mockResolvedValue({ id: "pay1", status: "SUCCEEDED", grossAmountCents: 5000, refundedCents: 0, source: "OFFLINE" });
    mockPrisma.invoicePayment.findMany.mockResolvedValue([{ id: "pay1", status: "SUCCEEDED", grossAmountCents: 5000, netAmountCents: 5000, refundedCents: 0 }]);

    const res = await POST(req({ amountCents: 5000 }), refundParams);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockFinixClient.createTransferReversal).not.toHaveBeenCalled();
    expect(mockPrisma.invoicePayment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ refundedCents: 5000, status: "REFUNDED" }) })
    );
  });

  it("calls Finix's reversal API for a FINIX-sourced payment and does not apply refundedCents optimistically", async () => {
    const { POST } = await loadRefund();
    mockAuth.mockResolvedValue(ownerAuth());
    mockPrisma.invoice.findFirst.mockResolvedValue(baseInvoice());
    mockPrisma.invoicePayment.findFirst.mockResolvedValue({ id: "pay1", status: "SUCCEEDED", grossAmountCents: 5000, refundedCents: 0, source: "FINIX", finixTransferId: "TR123" });
    mockFinixClient.createTransferReversal.mockResolvedValue({ id: "REV1", state: "PENDING", amount: 5000 });

    const res = await POST(req({ amountCents: 5000 }), refundParams);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.pending).toBe(true);
    expect(mockFinixClient.createTransferReversal).toHaveBeenCalledWith("TR123", expect.objectContaining({ refund_amount: 5000 }));
    // PRIORITY 7/reconciliation: the outgoing reversal must carry
    // tags.refundRequestId set to the persisted claim's real id — this is
    // what refundReconciliation.ts's reconcileRefundRequest() later
    // matches a stale claim against, never amount/timing/donor.
    expect(mockFinixClient.createTransferReversal).toHaveBeenCalledWith("TR123", expect.objectContaining({ tags: expect.objectContaining({ refundRequestId: "refund-req-test" }) }));
    // The webhook applies refundedCents once Finix confirms — this route
    // itself must not touch invoicePayment.update on the FINIX path.
    expect(mockPrisma.invoicePayment.update).not.toHaveBeenCalled();
  });
});
