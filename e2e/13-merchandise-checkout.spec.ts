import { test, expect } from "@playwright/test";
import { prisma, randomSuffix, cleanupOrg } from "./fixtures/db";

/**
 * ONE MERCH CHECKOUT INTENT -> MAX 1 FINIX CHARGE -> MAX 1 WGC PAYMENT ->
 * MAX 1 PRINTFUL ORDER (cold-review defect #1). Drives the real
 * POST /api/merchandise/checkout route directly (same route
 * MerchandiseGivingExperience.tsx's submitCheckout calls) against the real
 * fake-Finix-backed dev server and the real sandbox database — proves the
 * server-side clientAttemptId protection holds under a genuine double
 * submit, independent of whether the frontend behaves.
 */
test.describe("Merchandise checkout — double submit", () => {
  let churchId: string | null = null;
  let givingLinkId: string | null = null;

  test.afterEach(async () => {
    if (givingLinkId) {
      await prisma.wgcCheckout.deleteMany({ where: { givingPageId: givingLinkId } }).catch(() => {});
      const payments = await prisma.payment.findMany({ where: { givingLinkId }, select: { id: true } }).catch(() => []);
      for (const p of payments) {
        await prisma.donationReceipt.deleteMany({ where: { paymentId: p.id } }).catch(() => {});
      }
      await prisma.payment.deleteMany({ where: { givingLinkId } }).catch(() => {});
      await prisma.finixTransfer.deleteMany({ where: { churchId: churchId ?? undefined } }).catch(() => {});
      await prisma.givingLink.delete({ where: { id: givingLinkId } }).catch(() => {});
    }
    await cleanupOrg(churchId);
  });

  test("two concurrent submits with the SAME clientAttemptId result in exactly one Payment, one FinixTransfer, one WgcCheckout", async ({ request }) => {
    const suffix = randomSuffix();
    const church = await prisma.church.create({
      data: {
        name: `E2E Merch Checkout Org ${suffix}`,
        slug: `e2e-merch-checkout-${suffix}`,
        primaryContactEmail: `merch+${suffix}@e2e.wgcpayments.test`,
        status: "ACTIVE",
        finixMerchantId: "MU_e2e_merch_checkout",
      },
    });
    churchId = church.id;

    const givingLink = await prisma.givingLink.create({
      data: {
        churchId: church.id,
        publicSlug: `e2e-merch-link-${suffix}`,
        internalName: "E2E Merch Giving Link",
        publicTitle: "E2E Merch Giving Link",
        merchandiseEnabled: true,
        feeCoverEnabled: false,
      },
    });
    givingLinkId = givingLink.id;

    const clientAttemptId = `e2e-double-submit-${suffix}`;
    const body = {
      slug: givingLink.publicSlug,
      clientAttemptId,
      donationAmountCents: 5000,
      cartItems: [],
      shippingOptionId: null,
      address: null,
      donor: { name: "E2E Donor", email: `donor+${suffix}@e2e.wgcpayments.test` },
      token: "tok_e2e_card",
      paymentMethod: "card",
      fraudSessionId: "e2e-fraud-session",
      coverFees: false,
    };

    // Fire both requests truly concurrently — this is what a double-click
    // (or a browser-retried POST before the first response lands) looks
    // like at the network level.
    const [resA, resB] = await Promise.all([
      request.post("/api/merchandise/checkout", { data: body }),
      request.post("/api/merchandise/checkout", { data: body }),
    ]);

    const [dataA, dataB] = await Promise.all([resA.json(), resB.json()]);
    // Real network timing means the loser can land at one of two points:
    // either the winner's WgcCheckout row already reached SUCCEEDED (loser
    // gets the identical checkoutId back), or the loser's request raced in
    // while the winner's claim was still PENDING (loser correctly reports
    // PAYMENT_STATUS_UNCERTAIN rather than a second charge). Either way,
    // Finix is called AT MOST once — that's what the DB assertions below
    // prove; a matching checkoutId is the common case, not a requirement.
    const succeeded = [dataA, dataB].filter((d) => d.success);
    expect(succeeded.length, JSON.stringify({ dataA, dataB })).toBeGreaterThanOrEqual(1);
    const uncertainOrMatching = [dataA, dataB].every((d) => d.success ? d.checkoutId === succeeded[0].checkoutId : d.code === "PAYMENT_STATUS_UNCERTAIN");
    expect(uncertainOrMatching, JSON.stringify({ dataA, dataB })).toBe(true);

    const checkouts = await prisma.wgcCheckout.findMany({ where: { clientAttemptId } });
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0].paymentStatus).toBe("SUCCEEDED");

    const payments = await prisma.payment.findMany({ where: { givingLinkId: givingLink.id } });
    expect(payments).toHaveLength(1);

    const transfers = await prisma.finixTransfer.findMany({ where: { churchId: church.id } });
    expect(transfers).toHaveLength(1);
  });
});
