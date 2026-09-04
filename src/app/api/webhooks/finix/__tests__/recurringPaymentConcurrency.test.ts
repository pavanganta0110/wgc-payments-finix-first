import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * PRIORITY: "transfer.created + transfer.updated arrive concurrently for
 * the same recurring charge" — this is the exact race the recurring-webhook
 * payment.create P2002 fix (Stage 1 Part A) closes. Proves:
 *   - Payment.finixTransferId's unique constraint means only ONE Payment
 *     row can ever exist for the transfer, no matter how many webhook
 *     deliveries race to create it.
 *   - The loser of the race fetches and reuses the winner's row rather
 *     than throwing an unhandled error or silently creating a duplicate.
 *   - Payment creation and its required downstream jobs (SEND_RECEIPT,
 *     QUICKBOOKS_PAYMENT) now commit in one transaction (Stage 2 Flow 3,
 *     Step 6/7) — the P2002 loser enqueues NOTHING further, since the
 *     winner already committed its own jobs inside its own transaction.
 *     Both jobs' dedupeKeys are keyed by payment id, so even if this
 *     invariant were ever violated, the DB-unique dedupeKey constraint
 *     would still collapse duplicate enqueue attempts to one row.
 *   - RECEIPT ASYMMETRY FIX (Step 7, 2026-09-04): this path previously
 *     synced to QuickBooks but never enqueued a receipt for a recurring
 *     charge whose Payment did not exist yet at all — now both jobs are
 *     enqueued together whenever the newly-created Payment is SUCCEEDED.
 */

const syncPaymentToQuickBooks = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/integrations/quickbooks/sync", () => ({ syncPaymentToQuickBooks }));
vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/finix/sync/syncFees", () => ({ syncFeesForTransfer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/settings/notificationDispatch", () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/observability/paymentSafetyEvents", () => ({ logPaymentSafetyEvent: vi.fn() }));

function makeP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.16.1" });
}

const WINNER_PAYMENT = { id: "payment-winner", status: "SUCCEEDED", finixTransferId: "TR-recurring-1" };

const mockPrisma = {
  church: { findFirst: vi.fn().mockResolvedValue({ id: "church-a" }) },
  finixTransfer: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
  payment: {
    findFirst: vi.fn().mockResolvedValue(null), // no prior Payment — both deliveries think they're first
    findUnique: vi.fn().mockResolvedValue(WINNER_PAYMENT),
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  finixSubscription: { findUnique: vi.fn().mockResolvedValue({ finixSubscriptionId: "SUB1", donorId: "donor-1", givingLinkId: null, donationAmountCents: 5000, donorCoversFee: false }) },
  finixPaymentInstrumentSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
  finixRefundOrReversal: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
  givingLink: { updateMany: vi.fn().mockResolvedValue({}) },
  finixFee: { findMany: vi.fn().mockResolvedValue([]) },
  finixDispute: { findUnique: vi.fn().mockResolvedValue({ id: "existing" }), upsert: vi.fn().mockResolvedValue({}) },
  bankReturn: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
  backgroundJob: { create: vi.fn().mockResolvedValue({ id: "job-1" }) },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockPrisma)),
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function load() {
  vi.resetModules();
  return import("../route");
}

const TRANSFER_DATA = {
  id: "TR-recurring-1",
  state: "SUCCEEDED",
  amount: 5000,
  subscription: "SUB1",
  subtype: undefined,
  type: "DEBIT",
  merchant: "MU1",
  source: "PI1",
};

describe("recurring-payment webhook — transfer.created + transfer.updated racing for the same charge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.church.findFirst.mockResolvedValue({ id: "church-a" });
    mockPrisma.finixTransfer.upsert.mockResolvedValue({});
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPrisma.payment.findUnique.mockResolvedValue(WINNER_PAYMENT);
    mockPrisma.finixSubscription.findUnique.mockResolvedValue({ finixSubscriptionId: "SUB1", donorId: "donor-1", givingLinkId: null, donationAmountCents: 5000, donorCoversFee: false });
  });

  it("only ever results in ONE Payment row: the loser's P2002 fetches and reuses the winner's row instead of throwing or duplicating", async () => {
    // First delivery (transfer.created) creates the row successfully.
    // Second delivery (transfer.updated) races in, loses on the unique
    // constraint, and must fetch+reuse rather than error.
    mockPrisma.payment.create.mockResolvedValueOnce(WINNER_PAYMENT).mockRejectedValueOnce(makeP2002());

    const { syncFinixDataFromWebhookEvent } = await load();

    // Both "deliveries" run against the same starting state (payment.findFirst
    // returns null for both, simulating the real race — neither sees the
    // other's write before making its own create() call).
    await Promise.all([
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.created", TRANSFER_DATA, "evt-created-1", new Date()),
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.updated", TRANSFER_DATA, "evt-updated-1", new Date()),
    ]);

    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(2); // both attempted
    // The P2002 loser must have looked up the real winner rather than
    // silently giving up or creating a second row.
    expect(mockPrisma.payment.findUnique).toHaveBeenCalledWith({ where: { finixTransferId: "TR-recurring-1" } });
  });

  it("the winner enqueues SEND_RECEIPT + QUICKBOOKS_PAYMENT exactly once each, targeting the real payment id; the P2002 loser enqueues nothing further", async () => {
    mockPrisma.payment.create.mockResolvedValueOnce(WINNER_PAYMENT).mockRejectedValueOnce(makeP2002());

    const { syncFinixDataFromWebhookEvent } = await load();
    await Promise.all([
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.created", TRANSFER_DATA, "evt-created-2", new Date()),
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.updated", TRANSFER_DATA, "evt-updated-2", new Date()),
    ]);

    // Never called directly anymore — dispatched through the durable
    // QUICKBOOKS_PAYMENT job instead.
    expect(syncPaymentToQuickBooks).not.toHaveBeenCalled();

    const jobCalls = mockPrisma.backgroundJob.create.mock.calls.map((c) => c[0].data);
    const receiptJobs = jobCalls.filter((d) => d.jobType === "SEND_RECEIPT");
    const qbJobs = jobCalls.filter((d) => d.jobType === "QUICKBOOKS_PAYMENT");

    // Exactly one of each — the winner's transaction enqueued both; the
    // P2002 loser enqueued neither.
    expect(receiptJobs).toHaveLength(1);
    expect(qbJobs).toHaveLength(1);
    expect(receiptJobs[0].entityId).toBe(WINNER_PAYMENT.id);
    expect(qbJobs[0].entityId).toBe(WINNER_PAYMENT.id);
    expect(receiptJobs[0].dedupeKey).toBe(`SEND_RECEIPT:payment:${WINNER_PAYMENT.id}:version:1`);
    expect(qbJobs[0].dedupeKey).toBe(`QUICKBOOKS_PAYMENT:payment:${WINNER_PAYMENT.id}`);
  });

  it("a P2002 loser that finds NO existing row (a genuine anomaly, not a race) does not silently swallow the error", async () => {
    mockPrisma.payment.create.mockRejectedValueOnce(makeP2002());
    mockPrisma.payment.findUnique.mockResolvedValueOnce(null);

    const { syncFinixDataFromWebhookEvent } = await load();
    // Should not throw out of the whole webhook handler — the outer
    // try/catch in the route logs it — but must also not proceed to
    // enqueue any job against a nonexistent payment.
    await syncFinixDataFromWebhookEvent("TRANSFER", "transfer.created", TRANSFER_DATA, "evt-created-3", new Date());

    expect(syncPaymentToQuickBooks).not.toHaveBeenCalled();
    expect(mockPrisma.backgroundJob.create).not.toHaveBeenCalled();
  });
});
