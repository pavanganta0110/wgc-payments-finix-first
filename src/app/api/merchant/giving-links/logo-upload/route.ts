import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { logDashboardAction } from "@/lib/dashboardAudit";
import { uploadPublicLogo } from "@/lib/storage/logoStorage";
import { revalidatePath } from "next/cache";

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate file type (PNG, JPG, JPEG, WEBP)
    const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({
        error: "Invalid file type. Only PNG, JPG, JPEG, and WEBP are supported."
      }, { status: 400 });
    }

    // Validate size (max 5MB)
    const MAX_LOGO_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_LOGO_SIZE) {
      return NextResponse.json({
        error: "File too large. Maximum size is 5MB."
      }, { status: 400 });
    }

    // Get organization Finix ID
    const church = await prisma.church.findUnique({
      where: { id: auth.churchId },
      select: { finixMerchantId: true, finixIdentityId: true }
    });

    const linkedTo = church?.finixMerchantId || church?.finixIdentityId;
    if (!linkedTo) {
      return NextResponse.json({
        error: "Your organization is not initialized with a Finix account."
      }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const storageKey = `${auth.churchId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const logoUrl = await uploadPublicLogo(storageKey, buffer, file.type);

    // Invalidate giving pages for this church since they might use this logo
    const givingLinks = await prisma.givingLink.findMany({ where: { churchId: auth.churchId }, select: { publicSlug: true } });
    for (const link of givingLinks) {
      revalidatePath(`/g/${link.publicSlug}`);
      revalidatePath(`/embed/${link.publicSlug}`);
    }

    // 3. Audit log
    await logDashboardAction({
      churchId: auth.churchId,
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.rawRole,
      action: "giving_link.logo_uploaded",
      entityType: "giving_link",
      metadata: { fileName: file.name, fileSize: file.size, storageKey },
      req,
    });

    return NextResponse.json({
      success: true,
      logoUrl,
      fileName: file.name,
      fileSize: file.size,
    });

  } catch (err: any) {
    console.error("Logo upload error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
