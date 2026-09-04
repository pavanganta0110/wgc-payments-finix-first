import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BackgroundJob } from "@prisma/client";

const mockSendDonationReceipt = vi.fn();
const mockSyncPaymentToQuickBooks = vi.fn();
const mockComputePledgeFulfillment = vi.fn();
const mockSendReceiptEmail = vi.fn();
const mockSendInvoicePaymentReceiptEmail = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/giving/generateReceipt", () => ({ sendDonationReceipt: (...a: unknown[]) => mockSendDonationReceipt(...a) }));
vi.mock("@/lib/integrations/quickbooks/sync", () => ({ syncPaymentToQuickBooks: (...a: unknown[]) => mockSyncPaymentToQuickBooks(...a) }));
vi.mock("@/lib/pledges/pledgeFulfillment", () => ({ computePledgeFulfillment: (...a: unknown[]) => mockComputePledgeFulfillment(...a) }));
vi.mock("@/lib/giving/sendReceiptEmail", () => ({ sendReceiptEmail: (...a: unknown[]) => mockSendReceiptEmail(...a) }));
vi.mock("@/lib/invoices/invoiceEmails", () => ({ sendInvoicePaymentReceiptEmail: (...a: unknown[]) => mockSendInvoicePaymentReceiptEmail(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: { quickBooksSyncRecord: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } } }));

function makeJob(overrides: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: "job-1",
    jobType: "SEND_RECEIPT",
    status: "PROCESSING",
    entityType: "Payment",
    entityId: "payment-1",
    dedupeKey: "dedupe-1",
    payloadJson: {},
    attempts: 1,
    maxAttempts: 8,
    nextRunAt: new Date(),
    lockedAt: new Date(),
    leaseUntil: new Date(),
    workerId: "w1",
    lastError: null,
    lastErrorAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    failedAt: null,
    ...overrides,
  } as BackgroundJob;
}

beforeEach(() => vi.clearAllMocks());

describe("dispatchJob", () => {
  it("SEND_RECEIPT: calls sendDonationReceipt with the job's payload", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSendDonationReceipt.mockResolvedValue({ duplicate: false });
    const job = makeJob({ jobType: "SEND_RECEIPT", payloadJson: { paymentId: "pay-1", churchId: "church-1" } });
    await dispatchJob(job);
    expect(mockSendDonationReceipt).toHaveBeenCalledWith("pay-1", "church-1");
  });

  it("SEND_RECEIPT: propagates a real send failure so the outbox retries", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSendDonationReceipt.mockRejectedValue(new Error("send failed"));
    const job = makeJob({ jobType: "SEND_RECEIPT", payloadJson: { paymentId: "pay-1", churchId: "church-1" } });
    await expect(dispatchJob(job)).rejects.toThrow("send failed");
  });

  it("QUICKBOOKS_PAYMENT: a successful sync (no FAILED record) completes without throwing", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSyncPaymentToQuickBooks.mockResolvedValue(undefined);
    mockFindFirst.mockResolvedValue({ status: "SUCCEEDED" });
    const job = makeJob({ jobType: "QUICKBOOKS_PAYMENT", payloadJson: { paymentId: "pay-1" } });
    await expect(dispatchJob(job)).resolves.toBeUndefined();
  });

  it("QUICKBOOKS_PAYMENT: syncPaymentToQuickBooks never throws on its own (fire-and-forget design) — the handler must read the resulting sync record and throw itself so the outbox actually retries a real failure", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSyncPaymentToQuickBooks.mockResolvedValue(undefined); // never throws, per its own design
    mockFindFirst.mockResolvedValue({ status: "FAILED", errorMessage: "Intuit API error" });
    const job = makeJob({ jobType: "QUICKBOOKS_PAYMENT", payloadJson: { paymentId: "pay-1" } });
    await expect(dispatchJob(job)).rejects.toThrow("Intuit API error");
  });

  it("QUICKBOOKS_PAYMENT: no sync record at all (integration not connected) is a legitimate no-op, not a failure", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSyncPaymentToQuickBooks.mockResolvedValue(undefined);
    mockFindFirst.mockResolvedValue(null);
    const job = makeJob({ jobType: "QUICKBOOKS_PAYMENT", payloadJson: { paymentId: "pay-1" } });
    await expect(dispatchJob(job)).resolves.toBeUndefined();
  });

  it("PLEDGE_RECOMPUTE: calls computePledgeFulfillment with the pledge id", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockComputePledgeFulfillment.mockResolvedValue(undefined);
    const job = makeJob({ jobType: "PLEDGE_RECOMPUTE", entityType: "Pledge", entityId: "pledge-1", payloadJson: { pledgeId: "pledge-1" } });
    await dispatchJob(job);
    expect(mockComputePledgeFulfillment).toHaveBeenCalledWith("pledge-1");
  });

  it("SEND_PLAIN_EMAIL: calls sendReceiptEmail with the job's payload fields in order", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSendReceiptEmail.mockResolvedValue(undefined);
    const job = makeJob({
      jobType: "SEND_PLAIN_EMAIL",
      entityType: "FinixSubscription",
      entityId: "sub-1",
      payloadJson: { to: "donor@example.com", name: "Jane Doe", organizationName: "Grace Church", amountCents: 1000, isRecurring: true, interval: "MONTHLY", churchId: "church-1", donorId: "donor-1" },
    });
    await dispatchJob(job);
    expect(mockSendReceiptEmail).toHaveBeenCalledWith("donor@example.com", "Jane Doe", "Grace Church", 1000, true, "MONTHLY", "church-1", "donor-1");
  });

  it("INVOICE_RECEIPT: calls sendInvoicePaymentReceiptEmail with rethrow:true so a real failure propagates and the outbox retries", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSendInvoicePaymentReceiptEmail.mockResolvedValue(undefined);
    const job = makeJob({ jobType: "INVOICE_RECEIPT", entityType: "InvoicePayment", entityId: "invpay-1", payloadJson: { invoiceId: "inv-1", invoicePaymentId: "invpay-1" } });
    await dispatchJob(job);
    expect(mockSendInvoicePaymentReceiptEmail).toHaveBeenCalledWith("inv-1", "invpay-1", { rethrow: true });
  });

  it("INVOICE_RECEIPT: propagates a real send failure so the outbox retries", async () => {
    const { dispatchJob } = await import("../jobHandlers");
    mockSendInvoicePaymentReceiptEmail.mockRejectedValue(new Error("send failed"));
    const job = makeJob({ jobType: "INVOICE_RECEIPT", entityType: "InvoicePayment", entityId: "invpay-1", payloadJson: { invoiceId: "inv-1", invoicePaymentId: "invpay-1" } });
    await expect(dispatchJob(job)).rejects.toThrow("send failed");
  });

  it("unregistered job type throws NoHandlerRegisteredError, never silently succeeds", async () => {
    const { dispatchJob, NoHandlerRegisteredError } = await import("../jobHandlers");
    const job = makeJob({ jobType: "PRINTFUL_ORDER" });
    await expect(dispatchJob(job)).rejects.toBeInstanceOf(NoHandlerRegisteredError);
  });
});
