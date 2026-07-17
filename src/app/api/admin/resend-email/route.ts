import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendWgcEmail, buildOnboardingStatusEmailContent } from "@/lib/email";
import { getAdminSession } from "@/lib/auth/session";

export async function POST(req: Request) {
  try {
    const session = await getAdminSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
    const status = app.onboardingStatus;
    const { subject, title, badgeText, badgeColor, bodyHtml } = buildOnboardingStatusEmailContent(
      status,
      app.organizationName
    );

    const response = await sendWgcEmail({
      to: contactEmail,
      subject,
      title,
      badgeText,
      badgeColor,
      bodyHtml
    });

    await prisma.emailLog.create({
      data: {
        onboardingApplicationId: app.id,
        type: "ADMIN_RESEND_" + (status || "UNKNOWN"),
        to: contactEmail,
        subject: subject,
        status: response.success ? "SENT" : "FAILED",
        sentAt: response.success ? new Date() : null,
        error: response.success ? null : String(response.error ?? "unknown error"),
      }
    });

    if (response.success) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }
  } catch (error) {
    console.error("Resend email error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
