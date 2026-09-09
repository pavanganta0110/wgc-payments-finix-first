import { describe, it, expect, vi } from "vitest";

/**
 * ONE MERCH CHECKOUT INTENT -> MAX 1 FINIX CHARGE -> MAX 1 WGC PAYMENT ->
 * MAX 1 PRINTFUL ORDER. Covers cold-review defect #1 (the frontend
 * previously regenerated clientAttemptId on every submit, defeating this
 * server-side protection entirely) and defect #2 (an ambiguous/timeout
 * Finix error must never be reported as "no charge was made," and must
 * never let a retry with the SAME id reach Finix a second time).
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    church: { findUnique: vi.fn() },
    givingLink: { findUnique: vi.fn(), update: vi.fn() },
    wgcCheckout: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn(), findUnique: vi.fn() },
    finixTransfer: { upsert: vi.fn() },
  },
}));
vi.mock("@/lib/giving/serverFeeStrategy", () => ({
  resolveWgcTransferFeeStrategy: vi.fn().mockReturnValue({
    feePaidBy: "ORGANIZATION",
    amountToChargeCents: 10000,
    expectedFeeCents: 255,
    supplementalFeeCents: 0,
    percentageBasisPoints: 230,
    fixedFeeCents: 25,
    normalizedCardBrand: "VISA",
    feeProfileId: "FP_ORG_PAID",
  }),
}));
vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/finix/client", () => ({
  finixClient: { getPaymentInstrument: vi.fn(), createBuyerIdentity: vi.fn(), createPaymentInstrument: vi.fn(), createTransfer: vi.fn() },
}));
vi.mock("@/lib/billing/paymentRouting", () => ({
  resolveProcessingMerchant: vi.fn(),
  buildIdempotencyKey: (...parts: (string | number)[]) => parts.join(":"),
}));
vi.mock("@/lib/donors/resolveOrCreateDonor", () => ({ resolveOrCreateDonor: vi.fn() }));
vi.mock("@/lib/giving/generateReceipt", () => ({ sendDonationReceipt: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/observability/paymentSafetyEvents", () => ({ logPaymentSafetyEvent: vi.fn() }));
vi.mock("../orderService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../orderService")>();
  return { ...actual, priceCartServerSide: vi.fn(), getShippingQuote: vi.fn(), createMerchandiseOrder: vi.fn() };
});

const DONATION_CENTS = 10000;

function makeP2002() {
  const err: any = new Error("Unique constraint failed");
  err.code = "P2002";
  return err;
}

async function setup() {
  vi.clearAllMocks();
  const { prisma } = await import("@/lib/prisma");
  const { finixClient } = await import("@/lib/finix/client");
  const { resolveProcessingMerchant } = await import("@/lib/billing/paymentRouting");
  const { resolveOrCreateDonor } = await import("@/lib/donors/resolveOrCreateDonor");
  const orderService = await import("../orderService");

  vi.mocked(prisma.church.findUnique).mockResolvedValue({ id: "church-a", finixMerchantId: "MU123", name: "Grace Church" } as never);
  vi.mocked(prisma.givingLink.findUnique).mockResolvedValue({ id: "link-1", churchId: "church-a", merchandiseEnabled: false, statementDescriptor: null, feeCoverEnabled: false } as never);

  // In-memory store keyed by clientAttemptId, mirroring the real @unique
  // constraint's behavior (including P2002 on a second concurrent create).
  const rows = new Map<string, any>();
  vi.mocked(prisma.wgcCheckout.findUnique).mockImplementation((async ({ where }: any) => rows.get(where.clientAttemptId) ?? null) as never);
  vi.mocked(prisma.wgcCheckout.create).mockImplementation((async ({ data }: any) => {
    if (rows.has(data.clientAttemptId)) throw makeP2002();
    const row = { id: `checkout-${rows.size + 1}`, ...data };
    rows.set(data.clientAttemptId, row);
    return row;
  }) as never);
  vi.mocked(prisma.wgcCheckout.update).mockImplementation((async ({ where, data }: any) => {
    const existing = [...rows.values()].find((r) => r.id === where.id);
    const updated = { ...existing, ...data };
    rows.set(existing.clientAttemptId, updated);
    return updated;
  }) as never);
  vi.mocked(prisma.payment.create).mockResolvedValue({ id: "payment-1" } as never);

  vi.mocked(finixClient.createBuyerIdentity).mockResolvedValue({ id: "ID123" } as never);
  vi.mocked(finixClient.createPaymentInstrument).mockResolvedValue({ id: "PI123", card: { brand: "VISA" } } as never);
  vi.mocked(resolveProcessingMerchant).mockResolvedValue({ chargeType: "MERCHANT_MERCHANDISE_ORDER", organizationId: "church-a", merchantId: "MU123", isWgcBillingMerchant: false } as never);
  vi.mocked(resolveOrCreateDonor).mockResolvedValue({ id: "donor-1" } as never);
  vi.mocked(orderService.priceCartServerSide).mockResolvedValue({ items: [], subtotal: 0, providerCost: 0 } as never);

  return { prisma, finixClient, rows };
}

const baseInput = {
  churchId: "church-a",
  givingLinkId: "link-1",
  cartItems: [],
  shippingOptionId: null,
  address: null,
  donor: { name: "Test Donor", email: "donor@example.com" },
  token: "tok_123",
  fraudSessionId: "fraud-session-1",
  donationAmountCents: DONATION_CENTS,
};

describe("processCombinedCheckout — one intent, at most one Finix charge", () => {
  it("double submit: two concurrent requests with the SAME clientAttemptId result in exactly ONE Finix charge", async () => {
    const { finixClient } = await setup();
    vi.mocked(finixClient.createTransfer).mockResolvedValue({ id: "TR1", state: "SUCCEEDED" } as never);
    const { processCombinedCheckout } = await import("../checkoutService");

    const [a, b] = await Promise.all([
      processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-double-click" }),
      processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-double-click" }),
    ]);

    expect(finixClient.createTransfer).toHaveBeenCalledTimes(1);
    // Both callers must resolve to the SAME underlying checkout, not two
    // independent ones.
    expect(a.id).toBe(b.id);
  });

  it("retry after a lost response: a second call with the same id after a prior SUCCEEDED checkout returns the existing result without charging Finix again", async () => {
    const { finixClient } = await setup();
    vi.mocked(finixClient.createTransfer).mockResolvedValue({ id: "TR2", state: "SUCCEEDED" } as never);
    const { processCombinedCheckout } = await import("../checkoutService");

    const first = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-retry-after-success" });
    const second = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-retry-after-success" });

    expect(finixClient.createTransfer).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
    expect(second.paymentStatus).toBe("SUCCEEDED");
  });

  it("Finix timeout: throws CheckoutUncertainError, marks the claim UNCERTAIN (never FAILED), and never says 'no charge was made'", async () => {
    const { finixClient, rows } = await setup();
    vi.mocked(finixClient.createTransfer).mockRejectedValue(new Error("Finix Error: request timed out after 20000ms"));
    const { processCombinedCheckout, CheckoutUncertainError } = await import("../checkoutService");

    await expect(processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-timeout" })).rejects.toBeInstanceOf(CheckoutUncertainError);
    await expect(processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-timeout-2" })).rejects.not.toMatchObject({ message: expect.stringContaining("No charge was made") });

    const row = rows.get("attempt-timeout");
    expect(row.paymentStatus).toBe("UNCERTAIN");
  });

  it("uncertain retry: a second call with the SAME id after a timeout returns the still-uncertain row instead of reaching Finix again", async () => {
    const { finixClient } = await setup();
    vi.mocked(finixClient.createTransfer).mockRejectedValueOnce(new Error("network error: ECONNRESET"));
    const { processCombinedCheckout, CheckoutUncertainError } = await import("../checkoutService");

    await expect(processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-uncertain-retry" })).rejects.toBeInstanceOf(CheckoutUncertainError);

    const second = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-uncertain-retry" });
    expect(finixClient.createTransfer).toHaveBeenCalledTimes(1); // never called a second time
    expect(second.paymentStatus).toBe("UNCERTAIN");
  });

  it("Finix confirms the transfer but the local Payment write fails: marks UNCERTAIN (not SUCCEEDED, not FAILED) and throws CheckoutUncertainError", async () => {
    const { finixClient, prisma } = await setup();
    vi.mocked(finixClient.createTransfer).mockResolvedValue({ id: "TR3", state: "SUCCEEDED" } as never);
    vi.mocked(prisma.payment.create).mockRejectedValue(new Error("db write failed"));
    const { processCombinedCheckout, CheckoutUncertainError } = await import("../checkoutService");

    await expect(processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-post-charge-write-fail" })).rejects.toBeInstanceOf(CheckoutUncertainError);

    const row = await prisma.wgcCheckout.findUnique({ where: { clientAttemptId: "attempt-post-charge-write-fail" } });
    expect(row?.paymentStatus).toBe("UNCERTAIN");
    expect(row?.finixTransferId).toBe("TR3");
  });

  it("a definite decline marks the claim FAILED, and a genuinely NEW clientAttemptId is required and permitted to charge again", async () => {
    const { finixClient } = await setup();
    vi.mocked(finixClient.createTransfer)
      .mockRejectedValueOnce(new Error("card declined: insufficient funds"))
      .mockResolvedValueOnce({ id: "TR4", state: "SUCCEEDED" } as never);
    const { processCombinedCheckout, CheckoutValidationError } = await import("../checkoutService");

    await expect(processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-declined" })).rejects.toBeInstanceOf(CheckoutValidationError);
    // A brand-new attempt id (the frontend's rotateAttemptId()) is a
    // genuinely new checkout intent and is allowed to reach Finix.
    const retried = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-declined-retry" });
    expect(finixClient.createTransfer).toHaveBeenCalledTimes(2);
    expect(retried.paymentStatus).toBe("SUCCEEDED");
  });

  it("successful order followed by an intentional second order (new clientAttemptId): both succeed as two independent charges", async () => {
    const { finixClient } = await setup();
    vi.mocked(finixClient.createTransfer)
      .mockResolvedValueOnce({ id: "TR5", state: "SUCCEEDED" } as never)
      .mockResolvedValueOnce({ id: "TR6", state: "SUCCEEDED" } as never);
    const { processCombinedCheckout } = await import("../checkoutService");

    const order1 = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-order-1" });
    const order2 = await processCombinedCheckout({ ...baseInput, clientAttemptId: "attempt-order-2" });

    expect(finixClient.createTransfer).toHaveBeenCalledTimes(2);
    expect(order1.id).not.toBe(order2.id);
    expect(order1.finixTransferId).toBe("TR5");
    expect(order2.finixTransferId).toBe("TR6");
  });
});
