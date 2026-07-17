import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth/session";
import { uploadIrsLetter } from "@/lib/onboarding/irsLetterService";

/**
 * Manual admin-side upload — for a 501(c)(3) letter that came in outside
 * the applicant's own onboarding flow (e.g. emailed to support). Always
 * attributed to the acting admin via uploadedByUserId, distinguishing it
 * from the organization's own self-serve upload (uploadedByUserId null).
 */
export async function POST(req: Request) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid upload." }, { status: 400 });

  const onboardingApplicationId = formData.get("onboardingApplicationId");
  const file = formData.get("file") as File | null;

  if (typeof onboardingApplicationId !== "string" || !onboardingApplicationId) {
    return NextResponse.json({ error: "Select an organization first." }, { status: 400 });
  }
  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Select a file to upload." }, { status: 400 });
  }

  const app = await prisma.onboardingApplication.findUnique({ where: { id: onboardingApplicationId } });
  if (!app) return NextResponse.json({ error: "Organization not found." }, { status: 404 });

  try {
    const result = await uploadIrsLetter({
      onboardingApplicationId,
      file,
      uploadedByUserId: session.userId,
    });

    await prisma.auditLog.create({
      data: {
        action: "DOCUMENT_UPLOADED_BY_ADMIN",
        actorEmail: session.email,
        onboardingApplicationId,
        metadata: { documentId: result.documentId, organizationName: app.organizationName },
      },
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    if (err.message && err.message !== "NOT_FOUND" && err.message !== "INVALID_FILE" && !err.message.startsWith("Storage")) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Admin document upload failed:", err);
    return NextResponse.json({ error: "We could not upload the document. Please try again." }, { status: 500 });
  }
}
