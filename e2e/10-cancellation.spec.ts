import { test, expect } from "@playwright/test";
import { prisma, seedOrgWithOwner, seedWgcSubscription, cleanupOrg, E2E_PASSWORD } from "./fixtures/db";
import { loginAsMerchant } from "./fixtures/auth";

/**
 * Journey 10: cancellation — owner cancels the subscription through the
 * real UI (subscription page -> Cancel Subscription -> confirm modal),
 * verifies WgcSubscription.status becomes CANCELED, and that dashboard
 * access is subsequently restricted (accessGate.ts's CANCELED state has
 * fullAccessAllowed: false).
 */
test.describe("Subscription cancellation", () => {
  let churchId: string | null = null;

  test.afterEach(async () => {
    await cleanupOrg(churchId);
  });

  test("owner cancels via the UI, subscription becomes CANCELED, and dashboard access is then restricted", async ({ page, context }) => {
    const { church, owner } = await seedOrgWithOwner({ namePrefix: "CancelOrg", billingSetupStatus: "BILLING_ACTIVE" });
    churchId = church.id;
    const subscription = await seedWgcSubscription({ organizationId: church.id, status: "ACTIVE", amountCents: 1000 });

    await loginAsMerchant(context.request, owner.email, E2E_PASSWORD);
    await page.goto("/merchant/subscription");
    await page.waitForLoadState("networkidle");

    // Client-side interactivity (this button's onClick, the modal it
    // opens) requires next.config.ts's allowedDevOrigins to include
    // Playwright's 127.0.0.1 baseURL — without it, Next's dev server 403s
    // every client JS chunk and no client-side code runs at all. See
    // next.config.ts's own comment on that setting for the full story
    // (previously misdiagnosed as an eval()-blocking sandbox limitation).
    await page.getByRole("button", { name: "Cancel Subscription" }).click();
    await expect(page.getByText("Cancel your WGC Platform subscription?")).toBeVisible();
    await page.getByRole("button", { name: "Confirm Cancellation" }).click();
    await expect(page.getByText("Cancel your WGC Platform subscription?")).not.toBeVisible();

    const updated = await prisma.wgcSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    expect(updated.status).toBe("CANCELED");
    expect(updated.canceledAt).toBeTruthy();
    expect(updated.canceledByUserId).toBe(owner.id);

    const auditEntries = await prisma.wgcBillingAuditLog.findMany({ where: { organizationId: church.id } });
    expect(auditEntries.some((e) => e.action === "subscription.canceled")).toBe(true);

    // Dashboard access is now restricted (CANCELED -> fullAccessAllowed: false).
    await page.goto("/merchant/donors");
    await expect(page.getByText(/isn.t available right now|Reactivate to restore full dashboard access/i)).toBeVisible();
  });

  test("cancellation is idempotent-safe: a second cancel attempt is rejected, never double-canceled", async ({ context }) => {
    const { church, owner } = await seedOrgWithOwner({ namePrefix: "CancelTwiceOrg", billingSetupStatus: "BILLING_ACTIVE" });
    churchId = church.id;
    await seedWgcSubscription({ organizationId: church.id, status: "CANCELED", amountCents: 1000 });

    await loginAsMerchant(context.request, owner.email, E2E_PASSWORD);
    const res = await context.request.post("/api/merchant/subscription/cancel");
    expect(res.status()).toBe(400);
  });
});
