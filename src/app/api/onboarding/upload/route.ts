import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { finixClient } from "@/lib/finix/client";
import { sendWgcEmail, sendWgcAdminEmail } from "@/lib/email";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const token = formData.get("token") as string;
    const file = formData.get("file") as File | null;
    // "Update Data" style underwriting requests (DBA, ownership/business
    // type, MCC, email) have no document to upload at all — previously
    // this route required a file unconditionally, so a merchant asked only
    // for a field correction had no way to submit anything (2026-09-04
    // finding: Finix's own UPDATE_REQUESTED outcomes for a real merchant
    // were mostly "Update Data", not "Upload File"). These map to Finix's
    // real Identity.entity fields, confirmed against this same codebase's
    // own onboarding-creation payload (see route.ts's identityPayload).
    const doingBusinessAs = (formData.get("doingBusinessAs") as string | null)?.trim() || undefined;
    const businessType = (formData.get("businessType") as string | null)?.trim() || undefined;
    const mcc = (formData.get("mcc") as string | null)?.trim() || undefined;
    const email = (formData.get("email") as string | null)?.trim() || undefined;
    const hasFieldUpdates = Boolean(doingBusinessAs || businessType || mcc || email);

    if (!token || (!file && !hasFieldUpdates)) {
      return NextResponse.json({ error: "Missing token, and no file or field update provided" }, { status: 400 });
    }

    // Hash the provided token to compare with database
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const app = await prisma.onboardingApplication.findFirst({
      where: {
        updateTokenHash: tokenHash,
        updateTokenExpiresAt: {
          gt: new Date() // Token must not be expired
        }
      }
    });

    if (!app) {
      return NextResponse.json({ error: "Invalid or expired secure link." }, { status: 403 });
    }

    if (!app.finixMerchantId) {
      return NextResponse.json({ error: "Configuration error: Merchant missing." }, { status: 400 });
    }

    if (hasFieldUpdates && !app.finixIdentityId) {
      return NextResponse.json({ error: "Configuration error: Identity missing." }, { status: 400 });
    }

    // Validate file, if one was provided
    if (file) {
      const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
      if (!allowedTypes.includes(file.type)) {
        return NextResponse.json({ error: "Invalid file type. Only JPG, PNG, and PDF are allowed." }, { status: 400 });
      }

      if (file.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: "File too large. Maximum size is 10MB." }, { status: 400 });
      }
    }

    // Only two business_type values are ever sent by this platform's own
    // onboarding-creation flow (src/app/api/onboarding/route.ts) — churches
    // are always TAX_EXEMPT_ORGANIZATION. Reject anything else outright
    // rather than forwarding an unvalidated string to Finix's Identity API.
    if (businessType && businessType !== "TAX_EXEMPT_ORGANIZATION" && businessType !== "CORPORATION") {
      return NextResponse.json({ error: "Invalid ownership type." }, { status: 400 });
    }

    // 1. Push any requested field corrections to the Finix Identity first —
    // these are independent of the file upload below and Finix re-reviews
    // both together once the single verification trigger (step 3) fires.
    if (hasFieldUpdates && app.finixIdentityId) {
      const entity: Record<string, string> = {};
      if (doingBusinessAs) entity.doing_business_as = doingBusinessAs;
      if (businessType) entity.business_type = businessType;
      if (mcc) entity.mcc = mcc;
      if (email) entity.email = email;
      await finixClient.updateIdentity(app.finixIdentityId, { entity });
    }

    let finixFileId: string | undefined;
    if (file) {
      // 2. Create File Resource in Finix
      const fileResource = await finixClient.createFileResource({
        display_name: file.name,
        linked_to: app.finixMerchantId,
        type: "ADDITIONAL_DOCUMENTATION"
      });

      finixFileId = fileResource.id;
      if (!finixFileId) {
        throw new Error("Failed to create file resource in Finix.");
      }

      // 3. Upload File Content to Finix
      await finixClient.uploadFileContent(finixFileId, file);
    }

    // 4. Trigger a new Verification if Identity exists — once, regardless
    // of whether this submission included a file, field updates, or both.
    if (app.finixIdentityId) {
      try {
        await finixClient.createVerification(app.finixIdentityId);
      } catch (err) {
        console.warn("Could not trigger verification directly. Finix might auto-trigger it.", err);
      }
    }

    // 5. Create Audit Record (file submissions only — MerchantDocument is
    // document-shaped; field-update changes are captured in the admin
    // email below instead of a new table for this initial gap-fix).
    if (file && finixFileId) {
      await prisma.merchantDocument.create({
        data: {
          onboardingApplicationId: app.id,
          documentType: "ADDITIONAL_DOCUMENTATION",
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          uploadStatus: "SUCCESS",
          finixFileId: finixFileId,
          uploadedBy: "MERCHANT",
        }
      });
    }

    // 6. Update Database Status & Invalidate Token
    await prisma.onboardingApplication.update({
      where: { id: app.id },
      data: {
        onboardingStatus: "UNDER_REVIEW",
        lastUpdateSubmittedAt: new Date(),
        lastStatusChangedAt: new Date(),
        updateTokenHash: null,
        updateTokenExpiresAt: null
      }
    });

    // 7. Send Email to Merchant
    const safeOrgName = app.organizationName || "your organization";
    await sendWgcEmail({
      to: app.contactEmail,
      subject: "Additional information received — WGC Payments",
      title: "Additional information received",
      badgeText: "Under Review",
      badgeColor: "#0B5DBC",
      bodyHtml: `<p>We have received the additional information for your WGC Payments account for <strong>${safeOrgName}</strong>.</p>
                 <p>Your application has been resubmitted for review. We will notify you once the review is completed or if any further information is required.</p>`
    });

    // 8. Send Email to Admin
    const fieldsUpdated = [
      doingBusinessAs ? "DBA" : null,
      businessType ? "Ownership Type" : null,
      mcc ? "MCC" : null,
      email ? "Email" : null,
    ].filter((f): f is string => Boolean(f));
    const whatChanged = [
      file ? `document "${file.name}"` : null,
      fieldsUpdated.length > 0 ? `field update(s): ${fieldsUpdated.join(", ")}` : null,
    ].filter(Boolean).join(" and ");

    await sendWgcAdminEmail({
      merchantName: safeOrgName,
      contactEmail: app.contactEmail,
      finixMerchantId: app.finixMerchantId || undefined,
      finixIdentityId: app.finixIdentityId || undefined,
      newStatus: "UNDER_REVIEW",
      documentsUploaded: file?.name,
      whatHappened: `The merchant submitted ${whatChanged} via the secure link. A new verification was triggered.`,
      actionNeeded: "Wait for Finix to review the new verification.",
      adminDashboardLink: "https://www.wgcpayments.com/admin/merchant-applications",
      customSubject: `Merchant submitted requested information — ${safeOrgName}`
    });

    return NextResponse.json({ success: true, message: "Information submitted successfully." });
  } catch (error: any) {
    console.error("Secure upload error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
