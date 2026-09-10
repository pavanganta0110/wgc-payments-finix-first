import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { logDashboardAction } from "@/lib/dashboardAudit";

export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  // Reauthentication gate — turning MFA off is at least as sensitive as
  // turning it on, and is the kind of thing an attacker who's already
  // inside a session would want to do to make their own access durable.
  const now = Math.floor(Date.now() / 1000);
  if (!auth.authTime || now - auth.authTime > 600) {
    return NextResponse.json({ error: "Reauthentication required. Please log in again to verify your identity.", reauthRequired: true }, { status: 403 });
  }

  await prisma.user.update({ where: { id: auth.userId }, data: { mfaEnabled: false } });

  await logDashboardAction({
    churchId: auth.churchId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.rawRole,
    action: "settings.mfa_disabled",
    entityType: "user",
    entityId: auth.userId,
    req,
  });

  return NextResponse.json({ success: true });
}
