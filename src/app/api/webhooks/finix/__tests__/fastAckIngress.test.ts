import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * MOCKED CONTROL-FLOW TESTS — Stage 2 Flow 3, the webhook fast-ack split.
 *
 * Proves the shape of POST itself: authenticate -> validate -> durably
 * persist (FinixWebhookEvent + PROCESS_FINIX_WEBHOOK BackgroundJob, one
 * transaction) -> 200, with NO business processing (WGC billing routing,
 * syncFinixDataFromWebhookEvent, onboarding-status transitions/emails) run
 * inline before that response. These are route-control-flow assertions
 * only — real PostgreSQL concurrency/idempotency proof is the separate,
 * currently-BLOCKED real-sandbox-DB suite (recurringChargeOrdering.realdb
 * .test.ts) documented in the Flow 3 checkpoint report, not a substitute
 * for it.
 */

// next/headers' headers() requires a real Next.js request-scope context
// that doesn't exist when calling the route handler directly in a unit
// test — mocked to read off the last Request built by postReq() below.
let lastReqHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => lastReqHeaders),
}));

// If POST were (incorrectly) still running business logic inline, these
// would be called synchronously during the POST() call itself — every
// test below asserts they are NOT.
const mockHandleWgcSubscriptionWebhookEvent = vi.fn().mockResolvedValue(false);
vi.mock("@/lib/billing/wgcSubscriptionWebhook", () => ({
  handleWgcSubscriptionWebhookEvent: (...a: unknown[]) => mockHandleWgcSubscriptionWebhookEvent(...a),
}));
const mockSyncPaymentInstrument = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: (...a: unknown[]) => mockSyncPaymentInstrument(...a) }));
vi.mock("@/lib/finix/sync/syncFees", () => ({ syncFeesForTransfer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/settings/notificationDispatch", () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/integrations/quickbooks/sync", () => ({ syncPaymentToQuickBooks: vi.fn().mockResolvedValue(undefined) }));

const mockPrisma = {
  finixWebhookEvent: {
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  onboardingApplication: { findFirst: vi.fn(), update: vi.fn() },
  church: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../route");
}

function postReq(body: unknown, headerOverrides?: Record<string, string>) {
  const auth = Buffer.from("testuser:testpass").toString("base64");
  const headers = new Headers({ authorization: `Basic ${auth}`, ...headerOverrides });
  lastReqHeaders = headers;
  return new Request("http://x/api/webhooks/finix", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function transferPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    entity: "TRANSFER",
    type: "updated",
    created_at: new Date().toISOString(),
    data: { id: "TR1", state: "SUCCEEDED", merchant: "MU1" },
    ...overrides,
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
  mockPrisma.backgroundJob.create.mockResolvedValue({ id: "job-1" });
});

describe("POST /api/webhooks/finix — fast-ack ingress control flow", () => {
  it("a valid new webhook persists the event + PROCESS_FINIX_WEBHOOK job in one transaction and 200s, without running any business logic inline", async () => {
    const { POST } = await load();
    const payload = transferPayload();
    const res = await POST(postReq(payload));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Webhook accepted");

    expect(mockPrisma.finixWebhookEvent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.finixWebhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ finixEventId: payload.id, entity: "TRANSFER", type: "transfer.updated" }) })
    );
    expect(mockPrisma.backgroundJob.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobType: "PROCESS_FINIX_WEBHOOK",
          entityType: "FinixWebhookEvent",
          entityId: "webhook-event-1",
          dedupeKey: "PROCESS_FINIX_WEBHOOK:webhookEvent:webhook-event-1",
        }),
      })
    );
    // Both writes happened inside the SAME transaction call, not two
    // separate top-level prisma calls -- proves the atomicity requirement
    // (webhook accepted => durable processing job exists, no crash window).
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // The actual business logic (Task 10 requirement: ingress must not do
    // business processing) never ran synchronously inside POST.
    expect(mockHandleWgcSubscriptionWebhookEvent).not.toHaveBeenCalled();
    expect(mockSyncPaymentInstrument).not.toHaveBeenCalled();
    expect(mockPrisma.onboardingApplication.findFirst).not.toHaveBeenCalled();
  });

  it("a duplicate webhook (same finixEventId already recorded) returns a safe 200 with no new event or job", async () => {
    mockPrisma.finixWebhookEvent.findUnique.mockResolvedValue({ id: "existing-1" });
    const { POST } = await load();
    const res = await POST(postReq(transferPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Already processed");
    expect(mockPrisma.finixWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate delivery that races past the findUnique check and loses on the unique constraint (P2002) also returns a safe 200 with no duplicate job", async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.16.1" })
    );
    const { POST } = await load();
    const res = await POST(postReq(transferPayload()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toBe("Already processed");
    // The transaction rolled back -- no job could have been created since
    // the create() that would have produced its entityId never committed.
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it("a genuine persistence failure (not a duplicate) returns 500 with NO acknowledgment, so Finix retries delivery", async () => {
    mockPrisma.$transaction.mockRejectedValueOnce(new Error("connection terminated unexpectedly"));
    const { POST } = await load();
    const res = await POST(postReq(transferPayload()));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.message).not.toBe("Webhook accepted");
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it("invalid authentication is rejected before any persistence is attempted -- no event, no job", async () => {
    const { POST } = await load();
    const badAuth = new Headers({ authorization: `Basic ${Buffer.from("wrong:creds").toString("base64")}` });
    lastReqHeaders = badAuth;
    const res = await POST(
      new Request("http://x/api/webhooks/finix", { method: "POST", headers: badAuth, body: JSON.stringify(transferPayload()) })
    );
    expect(res.status).toBe(401);
    expect(mockPrisma.finixWebhookEvent.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.finixWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });

  it("a malformed (non-JSON) body is rejected with 400 -- current policy, unchanged by the fast-ack split -- with no event or job persisted", async () => {
    const { POST } = await load();
    const res = await POST(postReq("{not valid json"));
    expect(res.status).toBe(400);
    expect(mockPrisma.finixWebhookEvent.create).not.toHaveBeenCalled();
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });
});
