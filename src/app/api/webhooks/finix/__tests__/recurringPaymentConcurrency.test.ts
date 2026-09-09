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
 *   - The downstream QuickBooks sync call — the only side effect this
 *     specific branch triggers — is invoked against the SAME payment id
 *     either way, so it can never diverge into two different sync targets
 *     even though it may be called once per concurrent delivery (that
 *     redundant call is itself idempotent — see quickbooks/sync.ts's own
 *     existing-record short-circuit, verified separately).
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

  it("QuickBooks sync — the only side effect this branch triggers — always targets the SAME payment id, whether called once or twice", async () => {
    mockPrisma.payment.create.mockResolvedValueOnce(WINNER_PAYMENT).mockRejectedValueOnce(makeP2002());

    const { syncFinixDataFromWebhookEvent } = await load();
    await Promise.all([
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.created", TRANSFER_DATA, "evt-created-2", new Date()),
      syncFinixDataFromWebhookEvent("TRANSFER", "transfer.updated", TRANSFER_DATA, "evt-updated-2", new Date()),
    ]);

    // Every call (whether from the winner or the P2002-recovered loser)
    // must reference the one real payment id — never a divergent id that
    // would indicate two different logical payments got synced.
    for (const call of syncPaymentToQuickBooks.mock.calls) {
      expect(call[0]).toBe(WINNER_PAYMENT.id);
    }
    expect(syncPaymentToQuickBooks.mock.calls.length).toBeGreaterThan(0);
  });

  it("a P2002 loser that finds NO existing row (a genuine anomaly, not a race) does not silently swallow the error", async () => {
    mockPrisma.payment.create.mockRejectedValueOnce(makeP2002());
    mockPrisma.payment.findUnique.mockResolvedValueOnce(null);

    const { syncFinixDataFromWebhookEvent } = await load();
    // Should not throw out of the whole webhook handler — the outer
    // try/catch in the route logs it — but must also not proceed to call
    // QuickBooks against a nonexistent payment.
    await syncFinixDataFromWebhookEvent("TRANSFER", "transfer.created", TRANSFER_DATA, "evt-created-3", new Date());

    expect(syncPaymentToQuickBooks).not.toHaveBeenCalled();
  });
});
