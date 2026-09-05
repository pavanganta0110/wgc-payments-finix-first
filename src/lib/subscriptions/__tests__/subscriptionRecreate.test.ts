import { describe, it, expect, vi, beforeEach } from "vitest";

function makePrismaMock() {
  const subscriptions = new Map<string, any>();
  subscriptions.set("old-1", {
    id: "old-1",
    finixSubscriptionId: "fx-old-1",
    donorId: "D1",
    finixPaymentInstrumentId: "IN1",
    givingLinkId: null,
    fundId: null,
    amountCents: 2500,
    billingInterval: "MONTHLY",
  });

  return {
    donor: { findFirst: vi.fn().mockResolvedValue({ id: "D1", name: "Jane Doe", email: "jane@example.com", anonymousPreference: false }) },
    finixPaymentInstrumentSnapshot: { findFirst: vi.fn().mockResolvedValue({ finixIdentityId: "ID1", cardLast4: "1111", bankLast4: null }) },
    church: { findUnique: vi.fn().mockResolvedValue({ finixMerchantId: "MU1", name: "Test Org" }) },
    finixSubscription: {
      findUnique: vi.fn(async ({ where }: any) => subscriptions.get(where.id)),
      findFirst: vi.fn(async ({ where }: any) => subscriptions.get(where.id)),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...subscriptions.get(where.id), ...data })),
      upsert: vi.fn(async ({ create }: any) => ({ id: "new-1", ...create })),
    },
    subscriptionConsent: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
}

const BASE_OLD_SUB = { id: "old-1", finixSubscriptionId: "fx-old-1", donorId: "D1", finixPaymentInstrumentId: "IN1", givingLinkId: null, fundId: null, amountCents: 2500, billingInterval: "MONTHLY" };

describe("recreateSubscriptionWithChange", () => {
  beforeEach(() => vi.resetModules());

  it("cancels the old Finix subscription and creates a new one with the changed amount, chained via supersedes", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockResolvedValue({ id: "fx-new-1", state: "ACTIVE", next_billing_date: null });
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange } = await import("@/lib/subscriptions/subscriptionRecreate");

    const result = await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-1" });

    expect(cancelSubscription).toHaveBeenCalledWith("fx-old-1");
    expect(createSubscription).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, billing_interval: "MONTHLY" }));
    expect(result.newSubscription.amountCents).toBe(5000);
    expect(result.newSubscription.supersedesSubscriptionId).toBe("old-1");
  });

  it("sends idempotencyKey to Finix as idempotency_id — PRIORITY 9/E: same intent must dedupe on Finix's side too", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockResolvedValue({ id: "fx-new-1", state: "ACTIVE", next_billing_date: null });
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange } = await import("@/lib/subscriptions/subscriptionRecreate");
    await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "the-exact-key" });

    expect(createSubscription).toHaveBeenCalledWith(expect.objectContaining({ idempotency_id: "the-exact-key" }));
  });

  it("changes only the frequency when newBillingInterval is provided, leaving amount unchanged", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockResolvedValue({ id: "fx-new-2", state: "ACTIVE", next_billing_date: null });
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange } = await import("@/lib/subscriptions/subscriptionRecreate");

    const result = await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newBillingInterval: "YEARLY", idempotencyKey: "key-2" });

    expect(createSubscription).toHaveBeenCalledWith(expect.objectContaining({ amount: 2500, billing_interval: "YEARLY" }));
    expect(result.newSubscription.billingInterval).toBe("YEARLY");
  });

  it("throws without calling Finix when the old subscription has no donor or instrument", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn();
    const createSubscription = vi.fn();
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange } = await import("@/lib/subscriptions/subscriptionRecreate");
    const oldSub = { id: "old-1", finixSubscriptionId: "fx-old-1", donorId: null, finixPaymentInstrumentId: null, givingLinkId: null, fundId: null, amountCents: 2500, billingInterval: "MONTHLY" };

    await expect(recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: oldSub, newAmountCents: 5000, idempotencyKey: "key-3" })).rejects.toThrow();
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("throws SubscriptionFinixConfirmedError (not a plain Error) when Finix confirms but a later DB write fails — callers must never treat this as safe-to-retry", async () => {
    const prismaMock = makePrismaMock();
    // The post-confirmation $transaction fails.
    prismaMock.$transaction = vi.fn().mockRejectedValue(new Error("connection lost"));
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockResolvedValue({ id: "fx-new-3", state: "ACTIVE", next_billing_date: null });
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange, SubscriptionFinixConfirmedError } = await import("@/lib/subscriptions/subscriptionRecreate");

    let caught: unknown;
    try {
      await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-4" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SubscriptionFinixConfirmedError);
    expect((caught as InstanceType<typeof SubscriptionFinixConfirmedError>).finixSubscriptionId).toBe("fx-new-3");
    // Finix was still only called once — the failure is purely local.
    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it("cold-review fix: cancelSubscription succeeds but createSubscription then throws a plain error — the old subscription is immediately marked CANCELED locally (never left showing stale ACTIVE), and the function throws SubscriptionFinixConfirmedError rather than a plain Error a caller could treat as safe-to-retry-from-scratch", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockRejectedValue(new Error("network error"));
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange, SubscriptionFinixConfirmedError } = await import("@/lib/subscriptions/subscriptionRecreate");

    let caught: unknown;
    try {
      await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-5" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SubscriptionFinixConfirmedError);
    // The critical assertion: the old subscription's CANCELED state was
    // persisted BEFORE createSubscription ever ran, not left dangling —
    // previously this write only happened after a successful create, so a
    // createSubscription failure here left the dashboard showing the old
    // subscription as still ACTIVE indefinitely even though Finix had
    // already canceled it.
    expect(prismaMock.finixSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-1" }, data: expect.objectContaining({ state: "CANCELED" }) })
    );
  });

  it("cold-review recheck fix: cancelSubscription() itself throws an ambiguous/timeout error — throws SubscriptionFinixConfirmedError (not a plain Error), marks the subscription CANCEL_UNCERTAIN, and never calls createSubscription", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockRejectedValue(new Error("Finix Error: request timed out after 20000ms"));
    const createSubscription = vi.fn();
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange, SubscriptionFinixConfirmedError } = await import("@/lib/subscriptions/subscriptionRecreate");

    let caught: unknown;
    try {
      await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-6" });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SubscriptionFinixConfirmedError);
    expect(createSubscription).not.toHaveBeenCalled();
    expect(prismaMock.finixSubscription.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "old-1" }, data: expect.objectContaining({ state: "CANCEL_UNCERTAIN" }) })
    );
  });

  it("cold-review recheck fix: a subscription already marked CANCEL_UNCERTAIN refuses to proceed at all — never re-issues cancelSubscription, never calls createSubscription", async () => {
    const prismaMock = makePrismaMock();
    prismaMock.finixSubscription.findUnique = vi.fn().mockResolvedValue({ id: "old-1", state: "CANCEL_UNCERTAIN" });
    const cancelSubscription = vi.fn();
    const createSubscription = vi.fn();
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange, SubscriptionFinixConfirmedError } = await import("@/lib/subscriptions/subscriptionRecreate");

    await expect(
      recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-7" })
    ).rejects.toBeInstanceOf(SubscriptionFinixConfirmedError);
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("a DEFINITE (non-ambiguous) cancelSubscription rejection propagates as a plain error — nothing happened, safe to retry cleanly", async () => {
    const prismaMock = makePrismaMock();
    const cancelSubscription = vi.fn().mockRejectedValue(new Error("subscription not found"));
    const createSubscription = vi.fn();
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange, SubscriptionFinixConfirmedError } = await import("@/lib/subscriptions/subscriptionRecreate");

    let caught: unknown;
    try {
      await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-8" });
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(SubscriptionFinixConfirmedError);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("retry safety: if the old subscription is already CANCELED locally (a prior attempt got that far), a retry never calls cancelSubscription again, only createSubscription", async () => {
    const prismaMock = makePrismaMock();
    // Simulate the state left behind by the previous test's failure mode —
    // canceled locally, no supersedesBySubscriptionId yet (no replacement
    // was ever created).
    prismaMock.finixSubscription.findUnique = vi.fn().mockResolvedValue({ id: "old-1", state: "CANCELED", supersededBySubscriptionId: null });
    const cancelSubscription = vi.fn().mockResolvedValue({});
    const createSubscription = vi.fn().mockResolvedValue({ id: "fx-new-retry", state: "ACTIVE", next_billing_date: null });
    vi.doMock("@/lib/prisma", () => ({ prisma: prismaMock }));
    vi.doMock("@/lib/finix/client", () => ({ finixClient: { cancelSubscription, createSubscription } }));
    vi.doMock("@/lib/finix/parseFinixDate", () => ({ parseFinixDate: () => null }));

    const { recreateSubscriptionWithChange } = await import("@/lib/subscriptions/subscriptionRecreate");
    const result = await recreateSubscriptionWithChange({ churchId: "church-A", actorUserId: "user-1", oldSubscription: BASE_OLD_SUB, newAmountCents: 5000, idempotencyKey: "key-5" });

    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(result.newSubscription.finixSubscriptionId).toBe("fx-new-retry");
  });
});
