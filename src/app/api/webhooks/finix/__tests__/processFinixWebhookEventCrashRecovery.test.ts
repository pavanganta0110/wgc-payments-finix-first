import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MOCKED CONTROL-FLOW TESTS — Stage 2 Flow 3, Task 6/7 crash-recovery
 * proofs for the PROCESS_FINIX_WEBHOOK worker path.
 *
 * These prove the CONTROL FLOW that makes crash recovery safe:
 *   - a FinixWebhookEvent already marked COMPLETED is never reprocessed,
 *     even if its BackgroundJob is reclaimed and retried (Task 5: a
 *     PROCESSING event must not mean "skip forever," but a COMPLETED one
 *     genuinely should be skipped — the two are deliberately different).
 *   - a FinixWebhookEvent still PENDING/PROCESSING/ERROR (i.e. NOT
 *     COMPLETED) is always reprocessed on retry — this is what makes
 *     "worker crashed mid-run" and "worker crashed after a partial
 *     failure" both eventually converge on PROCESSED, without a stuck
 *     event.
 *   - handleProcessFinixWebhook (the actual BackgroundJob handler) throws
 *     loudly on a missing FinixWebhookEvent row rather than silently
 *     succeeding, so a data-integrity bug is never masked as a completed
 *     job.
 *
 * Real duplicate-Payment/duplicate-job proof for the underlying
 * syncFinixDataFromWebhookEvent re-run is the separate, already-passing
 * mocked P2002 test (recurringPaymentConcurrency.test.ts) plus the
 * currently-BLOCKED real-sandbox-DB suite — this file only covers the
 * NEW control flow this increment adds on top of that (the event-level
 * COMPLETED short-circuit and the job handler's own dispatch).
 */

vi.mock("@/lib/billing/wgcSubscriptionWebhook", () => ({ handleWgcSubscriptionWebhookEvent: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/finix/sync/syncFees", () => ({ syncFeesForTransfer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/settings/notificationDispatch", () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/integrations/quickbooks/sync", () => ({ syncPaymentToQuickBooks: vi.fn().mockResolvedValue(undefined) }));

const mockPrisma = {
  finixWebhookEvent: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  finixRawEventArchive: { upsert: vi.fn().mockResolvedValue({}) },
  onboardingApplication: { findFirst: vi.fn().mockResolvedValue(null) },
  church: { findFirst: vi.fn().mockResolvedValue(null) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

const TRANSFER_PAYLOAD = {
  id: "evt-crash-1",
  entity: "TRANSFER",
  type: "updated",
  created_at: new Date().toISOString(),
  data: { id: "TR-crash-1", state: "SUCCEEDED", merchant: "MU1" },
};

function rowWith(processingStatus: string) {
  return {
    id: "webhook-event-1",
    finixEventId: TRANSFER_PAYLOAD.id,
    entity: "TRANSFER",
    type: "transfer.updated",
    occurredAt: new Date(TRANSFER_PAYLOAD.created_at),
    merchantId: "MU1",
    identityId: null,
    verificationId: null,
    onboardingState: null,
    verificationState: null,
    rawPayloadJson: TRANSFER_PAYLOAD,
    processedAt: processingStatus === "COMPLETED" ? new Date() : null,
    processingStatus,
    errorMessage: null,
    attempts: 1,
    lockedAt: null,
    leaseUntil: null,
    workerId: null,
    lastErrorAt: null,
    createdAt: new Date(),
  };
}

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

beforeEach(() => vi.clearAllMocks());

describe("processFinixWebhookEvent — crash-recovery / re-run safety", () => {
  it("a PENDING event (never started) is fully processed", async () => {
    const { processFinixWebhookEvent } = await loadRoute();
    await processFinixWebhookEvent(rowWith("PENDING") as never);

    // Reaches the "no matching onboarding app" terminal COMPLETED update --
    // proves the sync layer + onboarding lookup both ran.
    expect(mockPrisma.onboardingApplication.findFirst).toHaveBeenCalledTimes(1);
    const completedCall = mockPrisma.finixWebhookEvent.update.mock.calls.find(
      (c) => c[0].data.processingStatus === "COMPLETED"
    );
    expect(completedCall).toBeTruthy();
  });

  it("a PROCESSING event left over from a worker that crashed mid-run is reprocessed, not skipped forever (Task 5)", async () => {
    const { processFinixWebhookEvent } = await loadRoute();
    await processFinixWebhookEvent(rowWith("PROCESSING") as never);

    // If this were skipped, the onboarding lookup (and everything after
    // it) would never run -- reprocessing must actually happen.
    expect(mockPrisma.onboardingApplication.findFirst).toHaveBeenCalledTimes(1);
  });

  it("an ERROR event (a previous attempt threw) is retried from scratch on the next attempt", async () => {
    const { processFinixWebhookEvent } = await loadRoute();
    await processFinixWebhookEvent(rowWith("ERROR") as never);
    expect(mockPrisma.onboardingApplication.findFirst).toHaveBeenCalledTimes(1);
  });

  it("a COMPLETED event is NEVER reprocessed, even if the job that wraps it gets reclaimed and retried (Task 7's crash-after-commit scenario)", async () => {
    const { processFinixWebhookEvent } = await loadRoute();
    await processFinixWebhookEvent(rowWith("COMPLETED") as never);

    // No re-entry into the sync/onboarding logic at all -- this is what
    // prevents Task 7's dangerous case (Payment + jobs already committed,
    // only the final "mark PROCESSED" step was lost) from resending
    // onboarding-status emails or re-deriving anything on a harmless
    // lease-reclaim retry.
    expect(mockPrisma.onboardingApplication.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.finixWebhookEvent.update).not.toHaveBeenCalled();
  });
});

describe("handleProcessFinixWebhook — the BackgroundJob dispatch wrapper", () => {
  it("loads the FinixWebhookEvent by id from the job payload and processes it", async () => {
    mockPrisma.finixWebhookEvent.findUnique.mockResolvedValue(rowWith("PENDING"));
    vi.resetModules();
    const { dispatchJob } = await import("@/lib/jobs/jobHandlers");
    const job = {
      id: "job-1",
      jobType: "PROCESS_FINIX_WEBHOOK",
      payloadJson: { webhookEventId: "webhook-event-1" },
    } as never;

    await dispatchJob(job);
    expect(mockPrisma.finixWebhookEvent.findUnique).toHaveBeenCalledWith({ where: { id: "webhook-event-1" } });
    expect(mockPrisma.onboardingApplication.findFirst).toHaveBeenCalledTimes(1);
  });

  it("throws (so the outbox retries) rather than silently succeeding when the FinixWebhookEvent row is missing -- should be impossible since it's created in the same transaction as the job, so this is a loud data-integrity guard, not an expected path", async () => {
    mockPrisma.finixWebhookEvent.findUnique.mockResolvedValue(null);
    vi.resetModules();
    const { dispatchJob } = await import("@/lib/jobs/jobHandlers");
    const job = {
      id: "job-1",
      jobType: "PROCESS_FINIX_WEBHOOK",
      payloadJson: { webhookEventId: "missing-row" },
    } as never;

    await expect(dispatchJob(job)).rejects.toThrow(/FinixWebhookEvent missing-row not found/);
    expect(mockPrisma.onboardingApplication.findFirst).not.toHaveBeenCalled();
  });
});
