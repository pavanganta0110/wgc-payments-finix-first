import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Flow 2b (Stage 2, resumed after the main-sync merge): setup-link
 * subscription completion. Previously ran its required local writes
 * (finixSubscription upsert, superseded-subscription cancel,
 * subscriptionConsent, subscriptionSetupLink -> COMPLETED) as separate
 * non-atomic statements, then sent two confirmation emails synchronously
 * with swallow-on-failure try/catch and no durable record they still
 * needed sending after a crash. These tests prove the required state now
 * commits atomically with a SETUP_LINK_CONFIRMATION job enqueue, that no
 * synchronous email call happens in the route anymore, and that the
 * existing uncertain-outcome/claim-release safety rules are preserved.
 */

const mockCreateBuyerIdentity = vi.fn();
const mockCreatePaymentInstrument = vi.fn();
const mockCreateSubscription = vi.fn();
const mockCancelSubscription = vi.fn();
vi.mock("@/lib/finix/client", () => ({
  finixClient: {
    createBuyerIdentity: (...a: unknown[]) => mockCreateBuyerIdentity(...a),
    createPaymentInstrument: (...a: unknown[]) => mockCreatePaymentInstrument(...a),
    createSubscription: (...a: unknown[]) => mockCreateSubscription(...a),
    cancelSubscription: (...a: unknown[]) => mockCancelSubscription(...a),
  },
}));

vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/subscriptions/setupLinkRateLimit", () => ({ checkSetupLinkRateLimit: vi.fn(() => true) }));
vi.mock("@/lib/observability/paymentSafetyEvents", () => ({ logPaymentSafetyEvent: vi.fn() }));

const mockSendWgcEmail = vi.fn().mockResolvedValue({ success: true, data: {} });
vi.mock("@/lib/email", () => ({ sendWgcEmail: (...a: unknown[]) => mockSendWgcEmail(...a) }));

const LINK = {
  id: "link-1",
  churchId: "church-1",
  donorFirstName: "Jane",
  donorLastName: "Doe",
  donorEmail: "jane@example.com",
  amountCents: 5000,
  billingInterval: "MONTHLY",
  fundId: null,
  startDate: new Date("2026-01-01"),
  endDate: null,
  updateTargetFinixSubscriptionId: null,
  status: "SENT",
};

const mockPrisma = {
  subscriptionSetupLink: {
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ ...LINK }),
    update: vi.fn().mockResolvedValue({}),
  },
  church: { findUnique: vi.fn().mockResolvedValue({ id: "church-1", finixMerchantId: "MU1", name: "Grace Church", primaryContactEmail: "org@example.com" }) },
  donor: { upsert: vi.fn().mockResolvedValue({ id: "donor-1" }) },
  finixPaymentInstrumentSnapshot: { findUnique: vi.fn().mockResolvedValue({ cardLast4: "4242", bankLast4: null }) },
  finixSubscription: {
    findFirst: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  subscriptionConsent: { create: vi.fn().mockResolvedValue({}) },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../route");
}

function postReq(body: Record<string, unknown>) {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

const params = (token = "raw-token") => ({ params: Promise.resolve({ token }) });

const validBody = { finixToken: "TOK123", donorFirstName: "Jane", donorLastName: "Doe", consentAccepted: true };

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.subscriptionSetupLink.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.subscriptionSetupLink.findUnique.mockResolvedValue({ ...LINK });
  mockPrisma.church.findUnique.mockResolvedValue({ id: "church-1", finixMerchantId: "MU1", name: "Grace Church", primaryContactEmail: "org@example.com" });
  mockPrisma.donor.upsert.mockResolvedValue({ id: "donor-1" });
  mockPrisma.finixSubscription.findFirst.mockResolvedValue(null);
  mockCreateBuyerIdentity.mockResolvedValue({ id: "ID1" });
  mockCreatePaymentInstrument.mockResolvedValue({ id: "PI1" });
  mockCreateSubscription.mockResolvedValue({ id: "SUB1", state: "ACTIVE", next_billing_date: null });
});

describe("POST /api/setup/[token]/complete — transactional outbox", () => {
  it("commits subscription state and enqueues SETUP_LINK_CONFIRMATION in one transaction, with no synchronous email call", async () => {
    const { POST } = await load();
    const res = await POST(postReq(validBody), params());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.finixSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { finixSubscriptionId: "SUB1" } })
    );
    expect(mockPrisma.subscriptionConsent.create).toHaveBeenCalled();
    expect(mockPrisma.subscriptionSetupLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETED" }) })
    );
    expect(mockPrisma.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: "SETUP_LINK_CONFIRMATION",
          dedupeKey: "SETUP_LINK_CONFIRMATION:subscription:SUB1",
        }),
      })
    );
    // The route itself must never call sendWgcEmail directly anymore —
    // that's the whole point of moving it into the job handler.
    expect(mockSendWgcEmail).not.toHaveBeenCalled();
  });

  it("cancels the superseded subscription via Finix (outside the transaction) for a payment-update link, then commits the replacement atomically", async () => {
    mockPrisma.subscriptionSetupLink.findUnique.mockResolvedValue({ ...LINK, updateTargetFinixSubscriptionId: "SUB_OLD" });
    mockPrisma.finixSubscription.findFirst.mockResolvedValue({ id: "old-row-1", finixSubscriptionId: "SUB_OLD", attributedUserId: "user-1" });

    const { POST } = await load();
    const res = await POST(postReq(validBody), params());
    expect(res.status).toBe(200);

    expect(mockCancelSubscription).toHaveBeenCalledWith("SUB_OLD");
    expect(mockPrisma.finixSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-row-1" }, data: expect.objectContaining({ state: "CANCELED" }) })
    );
    expect(mockPrisma.finixSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ supersedesSubscriptionId: "old-row-1", attributedUserId: "user-1" }) })
    );
  });

  it("returns PAYMENT_STATUS_UNCERTAIN and does NOT release the claim when the transaction fails after Finix already confirmed the subscription", async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error("db write failed"));

    const { POST } = await load();
    const res = await POST(postReq(validBody), params());
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.code).toBe("PAYMENT_STATUS_UNCERTAIN");
    // Must NOT flip back to SENT — that would let the donor retry and
    // create a second real Finix subscription for the same intent.
    expect(mockPrisma.subscriptionSetupLink.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
  });

  it("releases the claim back to SENT when Finix itself fails, before any subscription was confirmed", async () => {
    mockCreateSubscription.mockRejectedValue(new Error("Finix API down"));

    const { POST } = await load();
    const res = await POST(postReq(validBody), params());
    expect(res.status).toBe(502);

    expect(mockPrisma.subscriptionSetupLink.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a double-submit (claim already taken) without touching Finix", async () => {
    mockPrisma.subscriptionSetupLink.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.subscriptionSetupLink.findUnique.mockResolvedValue({ ...LINK, status: "COMPLETING" });

    const { POST } = await load();
    const res = await POST(postReq(validBody), params());
    expect(res.status).toBe(410);
    expect(mockCreateSubscription).not.toHaveBeenCalled();
  });
});
