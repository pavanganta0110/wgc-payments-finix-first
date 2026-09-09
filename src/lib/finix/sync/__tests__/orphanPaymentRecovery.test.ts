import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentAttempt: { findUnique: vi.fn(), update: vi.fn() },
    givingLink: { findFirst: vi.fn(), update: vi.fn() },
    payment: { create: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/giving/generateReceipt", () => ({ sendDonationReceipt: vi.fn() }));
vi.mock("@/lib/integrations/quickbooks/sync", () => ({ syncPaymentToQuickBooks: vi.fn() }));

// P2002 needs a real PrismaClientKnownRequestError instance — its own
// constructor requires a Prisma-internal `clientVersion` meta shape, so
// this mirrors the exact pattern the codebase already uses elsewhere for
// the same purpose (see donate/route.ts's own P2002 handling).
function makeP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.16.1" });
}

describe("recoverOrphanedOneTimePayment — webhook orphan recovery (PRIORITY 5)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.paymentAttempt.update).mockResolvedValue({} as never);
    vi.mocked(prisma.givingLink.update).mockResolvedValue({} as never);
  });

  it("never reconstructs a Payment for a transfer that hasn't reached SUCCEEDED or PENDING yet", async () => {
    const { recoverOrphanedOneTimePayment } = await import("@/lib/finix/sync/paymentReconciliation");
    const { prisma } = await import("@/lib/prisma");

    const result = await recoverOrphanedOneTimePayment({
      finixTransferId: "TR1",
      churchId: "church_1",
      amountCents: 5000,
      state: "FAILED",
      tags: {},
      finixBuyerIdentityId: null,
      finixPaymentInstrumentId: null,
      idempotencyId: null,
    });

    expect(result.recovered).toBe(false);
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it("refuses to trust a matching PaymentAttempt from a DIFFERENT church — never a cross-tenant reconstruction", async () => {
    const { recoverOrphanedOneTimePayment } = await import("@/lib/finix/sync/paymentReconciliation");
    const { prisma } = await import("@/lib/prisma");

    vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue({
      id: "attempt_1",
      churchId: "church_OTHER",
      donorId: "donor_x",
      givingLinkId: "link_x",
      fundId: null,
      fundName: null,
      paymentMethodType: "PAYMENT_CARD",
      isAnonymous: false,
      note: null,
    } as never);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: "payment_1", amountCents: 5000 } as never);

    await recoverOrphanedOneTimePayment({
      finixTransferId: "TR2",
      churchId: "church_1",
      amountCents: 5000,
      state: "SUCCEEDED",
      tags: {},
      finixBuyerIdentityId: null,
      finixPaymentInstrumentId: null,
      idempotencyId: "idem_2",
    });

    // The mismatched attempt must never be used — donorId/givingLinkId on
    // the created Payment must be undefined, not the other church's values.
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ donorId: undefined, givingLinkId: undefined, paymentAttemptId: undefined }) })
    );
  });

  it("reconstructs the Payment from a matching same-church PaymentAttempt and increments giving-link counters exactly once", async () => {
    const { recoverOrphanedOneTimePayment } = await import("@/lib/finix/sync/paymentReconciliation");
    const { prisma } = await import("@/lib/prisma");

    vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue({
      id: "attempt_3",
      churchId: "church_1",
      donorId: "donor_1",
      givingLinkId: "link_1",
      fundId: "fund_1",
      fundName: "General",
      paymentMethodType: "PAYMENT_CARD",
      isAnonymous: false,
      note: null,
    } as never);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: "payment_3", amountCents: 7500 } as never);

    const result = await recoverOrphanedOneTimePayment({
      finixTransferId: "TR3",
      churchId: "church_1",
      amountCents: 7500,
      state: "SUCCEEDED",
      tags: { donation_amount_cents: "7500", fee_percentage_bps: "300", fee_fixed_cents: "30", card_brand: "VISA", fee_calculation_version: "v1" },
      finixBuyerIdentityId: "ID1",
      finixPaymentInstrumentId: "PI1",
      idempotencyId: "idem_3",
    });

    expect(result.recovered).toBe(true);
    expect(result.paymentId).toBe("payment_3");
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          churchId: "church_1",
          donorId: "donor_1",
          givingLinkId: "link_1",
          finixTransferId: "TR3",
          status: "SUCCEEDED",
          cardBrand: "VISA",
          percentageBps: 300,
          fixedFeeCents: 30,
        }),
      })
    );
    expect(prisma.givingLink.update).toHaveBeenCalledTimes(1);
    expect(prisma.givingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link_1" },
        data: expect.objectContaining({
          successfulDonations: { increment: 1 },
          totalCollectedCents: { increment: 7500 },
        }),
      })
    );
  });

  it("P2002 race: a concurrent writer already created the Payment — fetches and returns it instead of erroring or creating a second row", async () => {
    const { recoverOrphanedOneTimePayment } = await import("@/lib/finix/sync/paymentReconciliation");
    const { prisma } = await import("@/lib/prisma");

    vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue(null as never);
    vi.mocked(prisma.payment.create).mockRejectedValue(makeP2002());
    vi.mocked(prisma.payment.findUnique).mockResolvedValue({ id: "payment_existing", amountCents: 5000 } as never);

    const result = await recoverOrphanedOneTimePayment({
      finixTransferId: "TR4",
      churchId: "church_1",
      amountCents: 5000,
      state: "SUCCEEDED",
      tags: {},
      finixBuyerIdentityId: null,
      finixPaymentInstrumentId: null,
      idempotencyId: null,
    });

    expect(result.recovered).toBe(true);
    expect(result.paymentId).toBe("payment_existing");
    expect(result.reason).toBe("raced_created_elsewhere");
    // Never a second Payment row, and never counted twice against the
    // giving link (the branch that owns that increment never runs here).
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
    expect(prisma.givingLink.update).not.toHaveBeenCalled();
  });

  it("a tag-sourced givingLinkId is only trusted after being re-verified against a real GivingLink row for the same church", async () => {
    const { recoverOrphanedOneTimePayment } = await import("@/lib/finix/sync/paymentReconciliation");
    const { prisma } = await import("@/lib/prisma");

    vi.mocked(prisma.paymentAttempt.findUnique).mockResolvedValue(null as never);
    // Tag claims a givingLinkId, but no matching row exists for this church.
    vi.mocked(prisma.givingLink.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.payment.create).mockResolvedValue({ id: "payment_5", amountCents: 2500 } as never);

    await recoverOrphanedOneTimePayment({
      finixTransferId: "TR5",
      churchId: "church_1",
      amountCents: 2500,
      state: "SUCCEEDED",
      tags: { givingLinkId: "link_from_untrusted_tag" },
      finixBuyerIdentityId: null,
      finixPaymentInstrumentId: null,
      idempotencyId: null,
    });

    expect(prisma.givingLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "link_from_untrusted_tag", churchId: "church_1" } })
    );
    // Never trusted since the lookup found nothing — Payment created with
    // no givingLinkId rather than the unverified tag value.
    expect(prisma.payment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ givingLinkId: undefined }) }));
    expect(prisma.givingLink.update).not.toHaveBeenCalled();
  });
});
