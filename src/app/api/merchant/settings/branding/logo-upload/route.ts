import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { getSettingsPermissions } from "@/lib/settings/settingsPermissions";
import { logDashboardAction } from "@/lib/dashboardAudit";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await getSession();
  const permissions = getSettingsPermissions(session?.role);
  if (!session || !session.churchId || !permissions.canManageBranding) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Only PNG, JPG, JPEG, SVG, and WEBP are supported." },
        { status: 400 }
      );
    }
    if (file.size > MAX_LOGO_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB." }, { status: 400 });
    }

    const church = await prisma.church.findUnique({
      where: { id: session.churchId },
      select: { finixMerchantId: true, finixIdentityId: true },
    });
    const linkedTo = church?.finixMerchantId || church?.finixIdentityId;
    if (!linkedTo) {
      return NextResponse.json({ error: "Your organization is not initialized with a Finix account." }, { status: 400 });
    }

    // Same fallback-search-across-types approach as the giving-link logo
    // upload route — Finix's file resource `type` enum varies by
    // application configuration, so this probes for whichever one is
    // actually accepted rather than hardcoding one.
    const candidateTypes = [
      "ADDITIONAL_DOCUMENTATION",
      "SUPPORTING_DOCUMENT",
      "BUSINESS_REGISTRATION_DOCUMENT",
      "BANK_STATEMENT",
      "OTHER",
      "IDENTITY_DOCUMENT",
    ];
    let fileResource = null;
    let lastError = null;
    for (const type of candidateTypes) {
      try {
        fileResource = await finixClient.createFileResource({
          display_name: `org_logo_${Date.now()}_${file.name}`,
          linked_to: linkedTo,
          type,
        });
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
      }
    }

    if (!fileResource?.id) {
      return NextResponse.json(
        { error: `Failed to store logo in Finix. Last error: ${lastError?.message || "Unknown error"}` },
        { status: 502 }
      );
    }

    await finixClient.uploadFileContent(fileResource.id, file);

    const logoUrl = `/api/files/${fileResource.id}`;
    await prisma.church.update({ where: { id: session.churchId }, data: { logoUrl } });

    await logDashboardAction({
      churchId: session.churchId,
      actorUserId: session.userId,
      actorEmail: session.email,
      actorRole: session.role,
      action: "settings.branding_logo_uploaded",
      entityType: "church",
      entityId: session.churchId,
      metadata: { fileName: file.name, fileSize: file.size, fileId: fileResource.id },
      req,
    });

    return NextResponse.json({ success: true, logoUrl });
  } catch (err: any) {
    console.error("Org logo upload error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
