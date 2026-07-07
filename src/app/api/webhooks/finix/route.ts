import { NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { sendWgcEmail } from "@/lib/email";
const WEBHOOK_SECRET = process.env.FINIX_WEBHOOK_SECRET;

async function sendWebhookEmail(
  applicationId: string,
  type: string,
  to: string,
  subject: string,
  title: string,
  badgeText: string,
  badgeColor: string,
  bodyHtml: string,
  ctaText: string,
  ctaUrl: string
) {
  // Check if we already sent this type of email to prevent duplicates
  const existingLog = await prisma.emailLog.findFirst({
    where: {
      onboardingApplicationId: applicationId,
      type: type,
    },
  });

  if (existingLog) {
    console.log(`Email of type ${type} already sent for application ${applicationId}`);
    return;
  }

  try {
    const response = await sendWgcEmail({
      to,
      subject,
      title,
      badgeText,
      badgeColor,
      bodyHtml,
      ctaText,
      ctaUrl
    });

    const error = response.success ? null : response.error;
    const data = response.data;

    await prisma.emailLog.create({
      data: {
        onboardingApplicationId: applicationId,
        type: type,
        to: to,
        subject: subject,
        status: error ? "ERROR" : "SENT",
        providerMessageId: (data as any)?.data?.id || (data as any)?.id || null,
        error: error ? JSON.stringify(error) : null,
        sentAt: error ? null : new Date(),
      },
    });
  } catch (err) {
    console.error("Failed to send email:", err);
  }
}

export async function POST(req: Request) {
  try {
    const headerList = await headers();
    const authHeader = headerList.get("authorization") || "";
    const signature = headerList.get("finix-signature");
    const rawBody = await req.text();

    const basicAuthUser = process.env.FINIX_WEBHOOK_BASIC_USERNAME || "wgc_finix_webhook";
    const basicAuthPass = process.env.FINIX_WEBHOOK_BASIC_PASSWORD || "Pavankumarreddy145@";

    let isAuthenticated = false;

    // Check Basic Auth
    const match = authHeader.match(/^Basic\s+(.*)$/i);
    if (match) {
      const credentials = Buffer.from(match[1], "base64").toString("utf-8");
      const [username, password] = credentials.split(":");
      if (username === basicAuthUser && password === basicAuthPass) {
        isAuthenticated = true;
      }
    }

    // Check HMAC Signature if Basic Auth failed but secret is present
    if (!isAuthenticated && WEBHOOK_SECRET && signature) {
      const expectedSignature = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

      if (signature === expectedSignature) {
        isAuthenticated = true;
      }
    }

    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const eventType = payload.type;
    const eventId = payload.id;
    let relatedFinixId = null;

    // Determine related ID
    if (payload.data?.id) {
      relatedFinixId = payload.data.id;
    }

    // Save webhook event (idempotency check)
    const existingEvent = await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    });

    if (existingEvent) {
      return NextResponse.json({ message: "Already processed" }, { status: 200 });
    }

    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        provider: "FINIX",
        eventType,
        providerEventId: eventId,
        relatedFinixId,
        payload,
      },
    });

    try {
      // Process event based on type
      let app = null;

      if (payload.data?.id) {
        // Find application by Identity ID, Merchant ID, or Form ID
        app = await prisma.onboardingApplication.findFirst({
          where: {
            OR: [
              { finixIdentityId: payload.data.id },
              { finixMerchantId: payload.data.id },
              { finixMerchantId: payload.data.merchant }, // sometimes related via merchant field
              { finixIdentityId: payload.data.identity },
            ],
          },
        });
      }

      if (app) {
        const contactEmail = app.contactEmail;
        const contactName = app.contactName;
        const orgName = app.organizationName;

        switch (eventType) {
          case "onboarding_form.updated": {
            if (payload.data.status === "COMPLETED" || payload.data.status === "SUBMITTED") {
              if (app.status === "DRAFT" || app.status === "ONBOARDING_LINK_CREATED") {
                 await prisma.onboardingApplication.update({
                   where: { id: app.id },
                   data: { status: "SUBMITTED", submittedAt: new Date() }
                 });
                 const safeOrgName = orgName || "your organization";
                 await sendWebhookEmail(
                   app.id,
                   "ONBOARDING_SUBMITTED",
                   contactEmail,
                   "WGC Payments onboarding submitted",
                   "Your onboarding has been submitted",
                   "Under Review",
                   "#0B5DBC",
                   `<p>Thank you for submitting your WGC Payments onboarding for <strong>${safeOrgName}</strong>.</p>
                    <p>Your application is now under review. Most reviews are completed within 24–48 hours.</p>
                    <p>We will notify you once your account is approved or if additional information is required.</p>`,
                   "View Merchant Login",
                   "https://wgcpayments.com/merchant-login"
                 );
              }
            }
            break;
          }
          case "merchant.created":
          case "merchant.updated":
          case "merchant.underwritten": {
            const status = payload.data.status;
            const onboardingState = payload.data.onboarding_state;
            const processingEnabled = payload.data.processing_enabled || false;
            const settlementEnabled = payload.data.settlement_enabled || false;

            let newStatus = app.status;
            let approvedAt = app.approvedAt;
            let rejectedAt = app.rejectedAt;
            let updateRequestedAt = app.updateRequestedAt;

            if (status === "APPROVED") {
              newStatus = "APPROVED";
              if (!approvedAt) approvedAt = new Date();
              const safeOrgName = orgName || "your organization";
              await sendWebhookEmail(
                app.id,
                "APPROVED",
                contactEmail,
                "Your WGC Payments account has been approved",
                "Your account has been approved",
                "Approved",
                "#10B981", // Green
                `<p>Good news — your WGC Payments account for <strong>${safeOrgName}</strong> has been approved.</p>
                 <p>You can now access your merchant dashboard to view payments, create payment links, and manage account activity.</p>`,
                "Log in to Merchant Dashboard",
                "https://wgcpayments.com/merchant-login"
              );
            } else if (status === "REJECTED" || status === "FAILED") {
              newStatus = "REJECTED";
              if (!rejectedAt) rejectedAt = new Date();
              const safeOrgName = orgName || "your organization";
              await sendWebhookEmail(
                app.id,
                "REJECTED",
                contactEmail,
                "Update on your WGC Payments application",
                "Update on your application",
                "Not Approved",
                "#EF4444", // Red
                `<p>Thank you for your interest in WGC Payments.</p>
                 <p>After review, we are unable to approve the onboarding application for <strong>${safeOrgName}</strong> at this time.</p>
                 <p>If you believe this was a mistake or would like more information, please contact WGC Payments Support.</p>`,
                "Contact Support",
                "mailto:support@wgcpayments.com"
              );
            } else if (status === "PROVISIONING" || onboardingState === "PROVISIONING") {
              if (newStatus !== "APPROVED") {
                newStatus = "UNDER_REVIEW";
              }
            }

            if (processingEnabled && newStatus !== "APPROVED") {
              newStatus = "PROCESSING_ENABLED";
            }
            if (settlementEnabled && newStatus !== "APPROVED") {
              newStatus = "SETTLEMENT_ENABLED";
            }

            await prisma.onboardingApplication.update({
              where: { id: app.id },
              data: {
                status: newStatus,
                approvedAt,
                rejectedAt,
                finixMerchantId: payload.data.id,
                onboardingState: onboardingState || app.onboardingState,
                processingEnabled: processingEnabled,
                settlementEnabled: settlementEnabled,
              },
            });
            break;
          }
          case "identity.updated": {
            if (payload.data.status === "UPDATE_REQUESTED") {
              await prisma.onboardingApplication.update({
                where: { id: app.id },
                data: {
                  status: "ADDITIONAL_INFO_NEEDED",
                  updateRequestedAt: new Date(),
                },
              });

              const safeOrgName = orgName || "your organization";
              await sendWebhookEmail(
                app.id,
                "ADDITIONAL_INFO_NEEDED",
                contactEmail,
                "Additional information needed for your WGC Payments account",
                "Additional information is required",
                "Action Required",
                "#F59E0B", // Orange/Gold
                `<p>We need a little more information to continue reviewing your WGC Payments account for <strong>${safeOrgName}</strong>.</p>
                 <p>Please log in to your merchant dashboard or contact WGC Payments Support so we can help you complete the required updates.</p>`,
                "Contact Support",
                "mailto:support@wgcpayments.com"
              );
            }
            break;
          }
        }
      }

      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processedAt: new Date() },
      });

      return NextResponse.json({ success: true });
    } catch (processError) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processingError: (processError as Error).message },
      });
      throw processError; // Re-throw to return 500
    }
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
