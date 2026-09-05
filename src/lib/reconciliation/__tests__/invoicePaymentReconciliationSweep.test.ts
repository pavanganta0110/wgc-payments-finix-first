import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MOCKED CONTROL-FLOW TEST — Stage 2 Task 8, "INVOICE ORPHAN TEST" (item
 * 12): Finix transfer succeeded, local InvoicePayment is missing/
 * incomplete, the reconciler runs. Expected: 1 InvoicePayment, invoice
 * state repaired, 1 invoice receipt job, no second transfer.
 *
 * `finixClient` here exposes only the read-only `getTransfer` — no
 * `createTransfer` mock exists, so the reconciler is structurally
 * incapable of creating a second transfer (same proof shape as the
 * Payment orphan test).
 */

const mockGetTransfer = vi.fn();
vi.mock("@/lib/finix/client", () => ({ finixClient: { getTransfer: (...a: unknown[]) => mockGetTransfer(...a) } }));

const mockPrisma = {
  invoicePaymentAttempt: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
  invoicePayment: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  invoice: { findUnique: vi.fn(), update: vi.fn() },
  invoiceActivity: { create: vi.fn().mockResolvedValue({}) },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../invoicePaymentReconciliationSweep");
}

const STALE_ATTEMPT = {
  id: "invattempt-1",
  clientAttemptId: "client-invattempt-1",
  churchId: "church-1",
  invoiceId: "invoice-1",
  finixTransferId: "TR-invoice-orphan-1",
  updatedAt: new Date(Date.now() - 20 * 60 * 1000),
};

beforeEach(() => vi.clearAllMocks());

describe("reconcileStaleInvoicePaymentAttempts — the Invoice Orphan Test", () => {
  it("recovers an InvoicePayment for a Finix-succeeded transfer that has no local row, without ever creating a second transfer", async () => {
    mockPrisma.invoicePaymentAttempt.findMany.mockResolvedValue([STALE_ATTEMPT]);
    // No InvoicePayment exists yet for this transfer — the orphan gap. The
    // sweep re-checks after the repair attempt, so return null first, then
    // the newly-created row.
    mockPrisma.invoicePayment.findFirst
      .mockResolvedValueOnce(null) // this sweep's own "does one exist" check
      .mockResolvedValueOnce(null) // applyInvoicePaymentTransferState's own priorInvoicePayment lookup
      .mockResolvedValueOnce({ id: "invpay-recovered-1", status: "SUCCEEDED" }); // this sweep's post-repair re-check
    mockPrisma.invoicePaymentAttempt.findUnique.mockResolvedValue({
      id: "invattempt-1",
      clientAttemptId: "client-invattempt-1",
      churchId: "church-1",
      invoiceId: "invoice-1",
      status: "PROCESSING",
      finixTransferId: "TR-invoice-orphan-1",
      amountCents: 10000,
      idempotencyKey: "idem-inv-1",
      method: "CARD",
    });
    mockGetTransfer.mockResolvedValue({ id: "TR-invoice-orphan-1", state: "SUCCEEDED" });
    mockPrisma.invoicePayment.create.mockResolvedValue({ id: "invpay-recovered-1", status: "SUCCEEDED" });
    mockPrisma.invoice.findUnique.mockResolvedValue({
      id: "invoice-1", churchId: "church-1", totalCents: 10000, status: "SENT", firstViewedAt: null, dueDate: new Date("2099-01-01"), paidAt: null,
    });
    mockPrisma.invoicePayment.findMany.mockResolvedValue([{ status: "SUCCEEDED", grossAmountCents: 10000, netAmountCents: 10000, refundedCents: 0 }]);

    const { reconcileStaleInvoicePaymentAttempts } = await load();
    const result = await reconcileStaleInvoicePaymentAttempts();

    expect(result.candidatesChecked).toBe(1);
    expect(result.outcomes.RECOVERED).toBe(1);
    expect(mockPrisma.invoicePayment.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.invoicePayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finixTransferId: "TR-invoice-orphan-1", status: "SUCCEEDED", invoiceId: "invoice-1" }) })
    );
    // The required invoice receipt job, enqueued transactionally alongside
    // the InvoicePayment create (Task 8 item 4 — never a direct call).
    const jobCalls = mockPrisma.backgroundJob.create.mock.calls.map((c) => c[0].data);
    expect(jobCalls).toHaveLength(1);
    expect(jobCalls[0].jobType).toBe("INVOICE_RECEIPT");
    expect(jobCalls[0].payloadJson).toEqual({ invoiceId: "invoice-1", invoicePaymentId: "invpay-recovered-1" });
    // Invoice balance/state actually repaired, not just the payment row.
    expect(mockPrisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) })
    );
  });

  it("leaves an attempt with no finixTransferId STILL_UNCERTAIN — nothing at Finix to discover, never guessed at", async () => {
    mockPrisma.invoicePaymentAttempt.findMany.mockResolvedValue([{ ...STALE_ATTEMPT, finixTransferId: null }]);
    const { reconcileStaleInvoicePaymentAttempts } = await load();
    const result = await reconcileStaleInvoicePaymentAttempts();
    expect(result.outcomes.STILL_UNCERTAIN).toBe(1);
    expect(mockGetTransfer).not.toHaveBeenCalled();
    expect(mockPrisma.invoicePayment.create).not.toHaveBeenCalled();
  });

  it("an InvoicePayment that already exists is ALREADY_RESOLVED, never a duplicate", async () => {
    mockPrisma.invoicePaymentAttempt.findMany.mockResolvedValue([STALE_ATTEMPT]);
    mockPrisma.invoicePayment.findFirst.mockResolvedValue({ id: "already-there" }); // exists before reconciling
    mockPrisma.invoicePaymentAttempt.findUnique.mockResolvedValue({
      id: "invattempt-1", clientAttemptId: "client-invattempt-1", status: "SUCCEEDED", finixTransferId: "TR-invoice-orphan-1",
    });

    const { reconcileStaleInvoicePaymentAttempts } = await load();
    const result = await reconcileStaleInvoicePaymentAttempts();

    expect(result.outcomes.ALREADY_RESOLVED).toBe(1);
    expect(mockPrisma.invoicePayment.create).not.toHaveBeenCalled();
  });

  it("bounds the scan (no unbounded full-table read)", async () => {
    mockPrisma.invoicePaymentAttempt.findMany.mockResolvedValue([]);
    const { reconcileStaleInvoicePaymentAttempts } = await load();
    await reconcileStaleInvoicePaymentAttempts(10);
    expect(mockPrisma.invoicePaymentAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
});
