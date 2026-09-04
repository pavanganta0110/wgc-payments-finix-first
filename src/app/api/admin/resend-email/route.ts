import { NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const { applicationId } = await req.json();

    if (!applicationId) {
      return NextResponse.json({ error: "Application ID is required" }, { status: 400 });
    }

    const app = await prisma.onboardingApplication.findUnique({
      where: { id: applicationId }
    });

    if (!app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const contactEmail = app.contactEmail;
    const safeOrgName = app.organizationName || "your organization";

    let subject = "";
    let title = "";
    let badgeText = "";
    let badgeColor = "";
    let bodyHtml = "";

    const status = app.onboardingStatus;

    if (status === "APPROVED") {
      subject = "Your WGC Payments account has been approved";
      title = "Your account has been approved";
      badgeText = "Approved";
      badgeColor = "#10B981";
      bodyHtml = `<p>Good news — your WGC Payments account for <strong>${safeOrgName}</strong> has been approved.</p>
                  <p>You can now access your merchant dashboard to view payments, create payment links, and manage account activity.</p>`;
    } else if (status === "MORE_INFORMATION_REQUIRED" || status === "ADDITIONAL_INFO_NEEDED") {
      // Previously this branch sent a generic "log in to your dashboard"
      // message with no secure link and no actual requirement — merchants
      // don't have a login at this stage, and this button silently
      // diverged from the real requested-items/secure-link email the
      // original MERCHANT.UPDATED webhook sends (2026-09-04 finding: a
      // resend for Lighthouse Baptist Church would not have shown Finix's
      // real requirements at all). A resend now regenerates the secure
      // token (the previous one may be expired or already invalidated by
      // an earlier submission) and mirrors that same email exactly,
      // including the real updateRequestedItems list.
      const requestedItemsStr = app.updateRequestedItems || "Additional documentation is required to verify your business and identity.";
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      await prisma.onboardingApplication.update({
        where: { id: app.id },
        data: { updateTokenHash: tokenHash, updateTokenExpiresAt: expiresAt },
      });
      const secureLink = `https://www.wgcpayments.com/onboarding/update/${rawToken}`;

      subject = "Additional information needed for your WGC Payments account";
      title = "Additional information is required";
      badgeText = "Action Required";
      badgeColor = "#F59E0B";
      bodyHtml = `<p>We need additional information to continue reviewing your WGC Payments account for <strong>${safeOrgName}</strong>.</p>
                  <p><strong>Requested items:</strong><br/>${requestedItemsStr}</p>
                  <p>Please use the secure link below to submit the requested information.</p>
                  <p><a href="${secureLink}">Submit Required Information</a></p>`;
    } else if (status === "REJECTED") {
      subject = "Update on your WGC Payments application";
      title = "Update on your application";
      badgeText = "Not Approved";
      badgeColor = "#EF4444";
      bodyHtml = `<p>Thank you for your interest in WGC Payments.</p>
                  <p>After review, we are unable to approve the onboarding application for <strong>${safeOrgName}</strong> at this time.</p>
                  <p>If you believe this was a mistake or would like more information, please contact WGC Payments Support.</p>`;
    } else {
      subject = "WGC Payments onboarding update";
      title = "Your onboarding is in progress";
      badgeText = "Under Review";
      badgeColor = "#0B5DBC";
      bodyHtml = `<p>Thank you for submitting your WGC Payments onboarding for <strong>${safeOrgName}</strong>.</p>
                  <p>Your application is currently being reviewed. Most reviews are completed within 24–48 hours.</p>
                  <p>We will notify you once your account is approved or if additional information is required.</p>`;
    }

    const response = await sendWgcEmail({
      to: contactEmail,
      subject,
      title,
      badgeText,
      badgeColor,
      bodyHtml
    });

    if (response.success) {
      await prisma.emailLog.create({
        data: {
          onboardingApplicationId: app.id,
          type: "ADMIN_RESEND_" + (status || "UNKNOWN"),
          to: contactEmail,
          subject: subject,
          status: "SENT",
          sentAt: new Date()
        }
      });
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }
  } catch (error) {
    console.error("Resend email error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
