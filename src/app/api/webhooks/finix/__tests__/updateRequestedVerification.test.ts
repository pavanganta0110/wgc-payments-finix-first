import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Covers the UPDATE_REQUESTED requirement-parsing fix: Finix's
 * MERCHANT.UPDATED webhook body never carries the specific reason itself
 * (confirmed against a real production payload for Lighthouse Baptist
 * Church, 2026-09-04) — it only gives a `verification` ID pointing at a
 * separate Verification resource whose `outcomes` array is the actual
 * source of truth. These tests prove the handler fetches that resource and
 * parses it, falls back safely when the fetch fails, and always stores a
 * redacted raw payload regardless of which path was taken.
 *
 * MOCKED CONTROL-FLOW TEST — updated for Stage 2 Flow 3's fast-ack split
 * (2026-09-04): this business logic no longer runs inline inside POST.
 * POST now only persists the FinixWebhookEvent + its PROCESS_FINIX_WEBHOOK
 * job and returns 200; the onboarding-status logic these tests actually
 * care about now lives in processFinixWebhookEvent, invoked here the same
 * way the real PROCESS_FINIX_WEBHOOK job handler invokes it — directly,
 * against a webhookEvent row shaped like what POST's transaction would
 * have created.
 */

const mockGetVerification = vi.fn();
vi.mock("@/lib/finix/client", () => ({ finixClient: { getVerification: (...a: unknown[]) => mockGetVerification(...a) } }));

// next/headers' headers() requires a real Next.js request-scope context that
// doesn't exist when calling the route handler directly in a unit test —
// mocked to read off the last Request built by postReq() below instead.
let lastReqHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => lastReqHeaders),
}));

vi.mock("@/lib/billing/wgcSubscriptionWebhook", () => ({ handleWgcSubscriptionWebhookEvent: vi.fn().mockResolvedValue(false) }));

const mockSendWgcEmail = vi.fn().mockResolvedValue({ success: true, data: {} });
const mockSendWgcAdminEmail = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email", () => ({
  sendWgcEmail: (...a: unknown[]) => mockSendWgcEmail(...a),
  sendWgcAdminEmail: (...a: unknown[]) => mockSendWgcAdminEmail(...a),
}));

const APP_ROW = {
  id: "app-1",
  contactEmail: "contact@example.com",
  organizationName: "",
  legalBusinessName: "Lighthouse Baptist Church",
  onboardingStatus: "UNDER_REVIEW",
  finixMerchantId: "MU123",
  finixIdentityId: "ID123",
  finixApplicationId: "AP123",
};

const mockPrisma = {
  finixWebhookEvent: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  // sendWebhookEmail's own dedup-lock transaction (a DIFFERENT
  // prisma.$transaction call, inside processFinixWebhookEvent) needs
  // $queryRaw on whatever object the shared $transaction mock below hands
  // back — same mockPrisma object serves both call sites.
  $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
  finixRawEventArchive: { upsert: vi.fn().mockResolvedValue({}) },
  onboardingApplication: {
    findFirst: vi.fn().mockResolvedValue(APP_ROW),
    update: vi.fn().mockResolvedValue({}),
  },
  church: { findFirst: vi.fn().mockResolvedValue(null) },
  emailLog: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "email-log-1" }),
    update: vi.fn().mockResolvedValue({}),
  },
  // Ingress's persist-event+enqueue-job transaction operates on this same
  // mockPrisma object — mirrors the pattern already used by the Flow 2b/3
  // transactional-outbox tests (recurringPaymentConcurrency.test.ts,
  // setup/[token]/complete/route.test.ts), not a separately-shaped tx mock.
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../route");
}

/** Exercises both halves of the fast-ack split for one payload: POST's
 * ingress (persist + enqueue, must 200) and then the PROCESS_FINIX_WEBHOOK
 * job handler's actual business logic (processFinixWebhookEvent), exactly
 * as the real worker would sequence them — just without a real queue in
 * between. Returns the ingress response so tests can still assert on it. */
async function ingressThenProcess(
  routeModule: Awaited<ReturnType<typeof load>>,
  payload: ReturnType<typeof merchantUpdatedPayload>
) {
  const res = await routeModule.POST(postReq(payload));
  await routeModule.processFinixWebhookEvent(webhookEventRowFor(payload) as Parameters<typeof routeModule.processFinixWebhookEvent>[0]);
  return res;
}

/** Builds the FinixWebhookEvent row shape processFinixWebhookEvent expects,
 * as if POST's ingress transaction had just created it from this payload —
 * the same handoff shape the real PROCESS_FINIX_WEBHOOK job handler reads
 * back via prisma.finixWebhookEvent.findUnique(). */
function webhookEventRowFor(payload: { id: string; entity: string; type: string; created_at: string; data: unknown }) {
  return {
    id: "webhook-event-1",
    finixEventId: payload.id,
    entity: payload.entity,
    type: payload.type,
    occurredAt: new Date(payload.created_at),
    merchantId: null,
    identityId: null,
    verificationId: null,
    onboardingState: null,
    verificationState: null,
    rawPayloadJson: payload,
    processedAt: null,
    processingStatus: "PENDING",
    errorMessage: null,
    attempts: 0,
    lockedAt: null,
    leaseUntil: null,
    workerId: null,
    lastErrorAt: null,
    createdAt: new Date(),
  };
}

function postReq(payload: unknown) {
  const auth = Buffer.from("testuser:testpass").toString("base64");
  const headers = new Headers({ authorization: `Basic ${auth}` });
  lastReqHeaders = headers;
  return new Request("http://x/api/webhooks/finix", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function merchantUpdatedPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `evt-${Math.random()}`,
    entity: "MERCHANT",
    type: "updated",
    created_at: new Date().toISOString(),
    data: {
      id: "MU123",
      merchant: "MU123",
      onboarding_state: "UPDATE_REQUESTED",
      verification: "VIrw87j7jgcPqAwJJfgtgWAX",
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FINIX_WEBHOOK_BASIC_USERNAME = "testuser";
  process.env.FINIX_WEBHOOK_BASIC_PASSWORD = "testpass";
  delete process.env.FINIX_WEBHOOK_SECRET;
  delete process.env.FINIX_WEBHOOK_SIGNING_KEY;
  delete process.env.FINIX_WEBHOOK_BEARER_TOKEN;
  mockPrisma.finixWebhookEvent.findUnique.mockResolvedValue(null);
  mockPrisma.finixWebhookEvent.create.mockResolvedValue({ id: "webhook-event-1" });
  mockPrisma.onboardingApplication.findFirst.mockResolvedValue({ ...APP_ROW });
});

describe("MERCHANT.UPDATED / UPDATE_REQUESTED — resolves the real requirement from the Verification resource", () => {
  it("parses outcomes[].outcome_code into a specific, human-readable requested-items list", async () => {
    mockGetVerification.mockResolvedValue({
      state: "FAILED",
      outcomes: [
        { outcome_code: "BANK_STATEMENT_ONE_MONTH_REQUESTED" },
        { outcome_code: "INVALID_BUSINESS_TAX_ID", remediation_details: { field_name: "entity.business_tax_id" } },
      ],
    });
    const routeModule = await load();
    const res = await ingressThenProcess(routeModule, merchantUpdatedPayload());
    expect(res.status).toBe(200);

    expect(mockGetVerification).toHaveBeenCalledWith("VIrw87j7jgcPqAwJJfgtgWAX");
    const updateCall = mockPrisma.onboardingApplication.update.mock.calls[0][0];
    expect(updateCall.data.updateRequestedItems).toContain("Bank statement one month requested");
    expect(updateCall.data.updateRequestedItems).toContain("Invalid business tax id (entity.business_tax_id)");
    // Never the generic fallback once a real reason was resolved.
    expect(updateCall.data.updateRequestedItems).not.toContain("Additional documentation is required to verify your business and identity.");
  });

  it("falls back to the generic message (and still 200s) when the Verification fetch fails, without throwing", async () => {
    mockGetVerification.mockRejectedValue(new Error("Finix Error: 404 not found"));
    const routeModule = await load();
    const res = await ingressThenProcess(routeModule, merchantUpdatedPayload());
    expect(res.status).toBe(200);

    const updateCall = mockPrisma.onboardingApplication.update.mock.calls[0][0];
    expect(updateCall.data.updateRequestedItems).toBeUndefined();
    expect(mockSendWgcEmail).toHaveBeenCalledWith(
      expect.objectContaining({ bodyHtml: expect.stringContaining("Additional documentation is required to verify your business and identity.") })
    );
  });

  it("always stores a redacted raw payload in updateRequestedCodes — the fetched Verification when available, so the ground truth is recoverable even if outcome_code parsing misses a shape", async () => {
    mockGetVerification.mockResolvedValue({ state: "FAILED", outcomes: [] });
    const routeModule = await load();
    await ingressThenProcess(routeModule, merchantUpdatedPayload());

    const updateCall = mockPrisma.onboardingApplication.update.mock.calls[0][0];
    expect(updateCall.data.updateRequestedCodes).toEqual({ state: "FAILED", outcomes: [] });
    // Generic fallback message still used since outcomes was empty.
    expect(updateCall.data.updateRequestedItems).toBeUndefined();
  });

  it("never calls the Verification API when the Merchant payload has no verification id", async () => {
    const routeModule = await load();
    await ingressThenProcess(routeModule, merchantUpdatedPayload({ verification: undefined }));
    expect(mockGetVerification).not.toHaveBeenCalled();
    const updateCall = mockPrisma.onboardingApplication.update.mock.calls[0][0];
    expect(updateCall.data.updateRequestedCodes).toEqual(expect.objectContaining({ id: "MU123" }));
  });
});
