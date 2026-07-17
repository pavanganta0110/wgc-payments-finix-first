import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";

/**
 * Runs when an OnboardingApplication is approved. Creates (or updates) the
 * Church row — which nothing else in the codebase populates today — and
 * provisions a church_admin User account with a set-password link, then
 * sends the "secure dashboard access email" referenced in the approval
 * email copy. Idempotent: safe to call again on webhook retries (won't
 * re-send if a User already exists for this email).
 */
export async function provisionChurchAccount(app: {
  id: string;
  organizationName: string;
  legalBusinessName: string | null;
  contactEmail: string;
  contactName: string;
  finixMerchantId: string | null;
  finixIdentityId: string | null;
  finixApplicationId: string | null;
}) {
  const orgName = app.legalBusinessName || app.organizationName;
  const slugBase = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "church";

  let church = await prisma.church.findFirst({
    where: { onboardingApplicationId: app.id },
  });

  if (!church) {
    let slug = slugBase;
    let suffix = 1;
    while (await prisma.church.findUnique({ where: { slug } })) {
      slug = `${slugBase}-${suffix++}`;
    }

    church = await prisma.church.create({
      data: {
        name: orgName,
        slug,
        primaryContactEmail: app.contactEmail,
        onboardingApplicationId: app.id,
        finixMerchantId: app.finixMerchantId,
        finixIdentityId: app.finixIdentityId,
        finixApplicationId: app.finixApplicationId,
        status: "ACTIVE",
      },
    });
  } else {
    church = await prisma.church.update({
      where: { id: church.id },
      data: {
        finixMerchantId: app.finixMerchantId,
        finixIdentityId: app.finixIdentityId,
        finixApplicationId: app.finixApplicationId,
        status: "ACTIVE",
      },
    });
  }

  const existingUser = await prisma.user.findUnique({ where: { email: app.contactEmail } });

  if (existingUser) {
    // Account already exists (e.g. webhook retry) — just make sure it's
    // linked to this church, don't re-send the invite email.
    if (existingUser.churchId !== church.id) {
      await prisma.user.update({ where: { id: existingUser.id }, data: { churchId: church.id } });
    }
    return { church, user: existingUser, emailSent: false };
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const user = await prisma.user.create({
    data: {
      email: app.contactEmail,
      role: "church_admin",
      churchId: church.id,
      setPasswordTokenHash: tokenHash,
      setPasswordTokenExpiresAt: expiresAt,
    },
  });

  const setPasswordLink = `https://wgcpayments.com/merchant/set-password/${rawToken}`;

  const subject = "Your WGC Payments dashboard access";
  const result = await sendWgcEmail({
    to: app.contactEmail,
    subject,
    title: "Set up your dashboard access",
    badgeText: "Action Required",
    badgeColor: "#0B5DBC",
    bodyHtml: `<p>Hi ${app.contactName || orgName},</p>
               <p>Your WGC Payments merchant dashboard is ready. Use the secure link below to set your password and log in.</p>
               <p><a href="${setPasswordLink}">Set your password</a></p>
               <p>This link expires in 7 days. If it expires, contact WGC Payments Support and we'll send a new one.</p>`,
  });

  // sendWgcEmail never throws — it swallows Resend errors internally — so
  // this is the only place that failure is observable. Without logging it,
  // a failed send here leaves a fully-provisioned account whose owner never
  // receives the one link that lets them log in, with zero record anywhere.
  await prisma.emailLog.create({
    data: {
      onboardingApplicationId: app.id,
      type: "DASHBOARD_ACCESS",
      to: app.contactEmail,
      subject,
      status: result.success ? "SENT" : "FAILED",
      sentAt: result.success ? new Date() : null,
      error: result.success ? null : String(result.error ?? "unknown error"),
    },
  });

  if (!result.success) {
    await sendWgcEmail({
      to: process.env.SUPPORT_EMAIL || "support@wgcpayments.com",
      subject: `[ALERT] Dashboard access email failed to send — ${orgName}`,
      title: "Dashboard access email failed",
      badgeText: "Action Needed",
      badgeColor: "#EF4444",
      bodyHtml: `<p>The dashboard-access email to <strong>${app.contactEmail}</strong> (${orgName}) failed to send after account approval.</p>
                 <p>The account and set-password link were created successfully, but the customer has not been notified. Resend it manually from the admin dashboard.</p>`,
    }).catch((err) => console.error("Failed to send internal alert for dashboard-access email failure:", err));
  }

  return { church, user, emailSent: result.success };
}
