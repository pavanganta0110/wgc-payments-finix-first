import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getCurrentIrsLetter, reviewIrsLetter } from "@/lib/onboarding/irsLetterService";

/**
 * wgc_admin-only: full document metadata for the admin review card,
 * plus review actions. This review is informational/internal only — it
 * does not change OnboardingApplication.onboardingStatus or any Finix
 * approval state (per the explicit business rule that automatic
 * cross-linking is out of scope for now).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "wgc_admin") {
    return NextResponse.json({ error: "You do not have permission to access this document." }, { status: 401 });
  }

  const { applicationId } = await params;
  const [app, document] = await Promise.all([
    prisma.onboardingApplication.findUnique({ where: { id: applicationId }, select: { id: true, organizationName: true } }),
    getCurrentIrsLetter(applicationId),
  ]);
  if (!app) {
    return NextResponse.json({ error: "This document is not available." }, { status: 404 });
  }

  return NextResponse.json({
    applicationId: app.id,
    organizationName: app.organizationName,
    document: document
      ? {
          id: document.id,
          documentType: document.documentType,
          category: document.category,
          title: document.title,
          originalFilename: document.originalFilename,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          status: document.status,
          version: document.version,
          uploadedAt: document.uploadedAt,
          uploadedByUserId: document.uploadedByUserId,
          reviewedByUserId: document.reviewedByUserId,
          reviewedAt: document.reviewedAt,
          internalReviewNotes: document.internalReviewNotes,
          organizationFacingMessage: document.organizationFacingMessage,
        }
      : null,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "wgc_admin") {
    return NextResponse.json({ error: "You do not have permission to access this document." }, { status: 401 });
  }

  const { applicationId } = await params;
  const body = await req.json().catch(() => ({}));
  const document = await getCurrentIrsLetter(applicationId);
  if (!document) {
    return NextResponse.json({ error: "This document is not available." }, { status: 404 });
  }

  try {
    const updated = await reviewIrsLetter({
      onboardingApplicationId: applicationId,
      documentId: document.id,
      status: body.status,
      internalReviewNotes: typeof body.internalReviewNotes === "string" ? body.internalReviewNotes : undefined,
      organizationFacingMessage: typeof body.organizationFacingMessage === "string" ? body.organizationFacingMessage : undefined,
      reviewedByUserId: session.userId,
    });
    return NextResponse.json({ success: true, status: updated.status });
  } catch (err: any) {
    if (err.message === "INVALID_STATUS") {
      return NextResponse.json({ error: "Invalid review status." }, { status: 400 });
    }
    if (err.message === "NOT_FOUND") {
      return NextResponse.json({ error: "This document is not available." }, { status: 404 });
    }
    console.error("IRS letter review failed:", err);
    return NextResponse.json({ error: "We could not save this review. Please try again." }, { status: 500 });
  }
}
