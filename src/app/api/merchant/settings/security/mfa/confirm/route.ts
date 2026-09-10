import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { hashMfaCode, MFA_MAX_CODE_ATTEMPTS } from "@/lib/auth/mfaCode";
import { logDashboardAction } from "@/lib/dashboardAudit";

/**
 * Step 2 of turning on SMS MFA: verify the code sent to pendingPhone, then
 * — and only then — promote it to the real phone and flip mfaEnabled on.
 */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  if (!code) {
    return NextResponse.json({ error: "Missing verification code." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: auth.userId } });
  if (!user?.pendingPhone || !user.mfaCodeHash || !user.mfaCodeExpiresAt) {
    return NextResponse.json({ error: "No verification in progress. Please start over." }, { status: 400 });
  }
  if (user.mfaCodeExpiresAt < new Date()) {
    await clearPendingMfa(user.id);
    return NextResponse.json({ error: "This code has expired. Please start over." }, { status: 400 });
  }
  if (user.mfaCodeAttempts >= MFA_MAX_CODE_ATTEMPTS) {
    await clearPendingMfa(user.id);
    return NextResponse.json({ error: "Too many incorrect attempts. Please start over." }, { status: 400 });
  }

  if (hashMfaCode(code) !== user.mfaCodeHash) {
    await prisma.user.update({ where: { id: user.id }, data: { mfaCodeAttempts: { increment: 1 } } });
    return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      phone: user.pendingPhone,
      phoneVerifiedAt: new Date(),
      mfaEnabled: true,
      pendingPhone: null,
      mfaCodeHash: null,
      mfaCodeExpiresAt: null,
      mfaCodeAttempts: 0,
    },
  });

  await logDashboardAction({
    churchId: auth.churchId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.rawRole,
    action: "settings.mfa_enabled",
    entityType: "user",
    entityId: user.id,
    req,
  });

  return NextResponse.json({ success: true });
}

async function clearPendingMfa(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { pendingPhone: null, mfaCodeHash: null, mfaCodeExpiresAt: null, mfaCodeAttempts: 0 },
  });
}
