import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getCurrentIrsLetter, generateIrsLetterAccessUrl } from "@/lib/onboarding/irsLetterService";

/**
 * wgc_admin-only: generates a short-lived (5 minute) signed URL to view or
 * download the current IRS letter version. Never returns the storage key,
 * bucket name, or a permanent URL — and never logs the signed URL itself,
 * only the fact that access occurred (see generateIrsLetterAccessUrl's
 * audit call).
 */
export async function POST(req: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "wgc_admin") {
    return NextResponse.json({ error: "You do not have permission to access this document." }, { status: 401 });
  }

  const { applicationId } = await params;
  const body = await req.json().catch(() => ({}));
  const intent: "view" | "download" = body.intent === "download" ? "download" : "view";

  const document = await getCurrentIrsLetter(applicationId);
  if (!document) {
    return NextResponse.json({ error: "This document is not available." }, { status: 404 });
  }

  try {
    const { url, expiresInSeconds } = await generateIrsLetterAccessUrl({
      onboardingApplicationId: applicationId,
      documentId: document.id,
      actorUserId: session.userId,
      actorRole: session.role,
      intent,
    });
    return NextResponse.json({ url, expiresInSeconds });
  } catch (err) {
    console.error("Failed to generate IRS letter access URL:", err);
    return NextResponse.json({ error: "This document is not available." }, { status: 500 });
  }
}
