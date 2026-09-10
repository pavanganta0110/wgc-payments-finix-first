import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { normalizeUSPhone } from "@/lib/validation";
import { generateMfaCode, MFA_CODE_TTL_MINUTES } from "@/lib/auth/mfaCode";
import { getSmsProvider } from "@/lib/sms/smsProvider";
import { isSmsConfigured } from "@/lib/sms/sendText";

/**
 * Step 1 of turning on SMS MFA: validate the phone, text it a code, and
 * hold the number as pendingPhone — it only becomes the account's real
 * phone/mfaEnabled=true once confirm/route.ts verifies the code. Never
 * flips mfaEnabled here; a wrong number entered by mistake must never
 * lock the account into requiring a code that can never arrive.
 */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  if (!isSmsConfigured()) {
    return NextResponse.json({ error: "Two-factor authentication isn't available yet." }, { status: 503 });
  }

  // Reauthentication gate — same pattern as change-password and the
  // financial-mutation routes. Turning MFA on/off is a security setting,
  // not a routine one.
  const now = Math.floor(Date.now() / 1000);
  if (!auth.authTime || now - auth.authTime > 600) {
    return NextResponse.json({ error: "Reauthentication required. Please log in again to verify your identity.", reauthRequired: true }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const normalized = normalizeUSPhone(typeof body.phone === "string" ? body.phone : "");
  if (!normalized) {
    return NextResponse.json({ error: "Please enter a valid U.S. phone number." }, { status: 400 });
  }

  const { code, codeHash } = generateMfaCode();
  await prisma.user.update({
    where: { id: auth.userId },
    data: {
      pendingPhone: normalized,
      mfaCodeHash: codeHash,
      mfaCodeExpiresAt: new Date(Date.now() + MFA_CODE_TTL_MINUTES * 60 * 1000),
      mfaCodeAttempts: 0,
    },
  });

  const result = await getSmsProvider().send(normalized, `Your WGC Payments verification code is ${code}. It expires in ${MFA_CODE_TTL_MINUTES} minutes.`);
  if (!result.success) {
    return NextResponse.json({ error: result.error || "Couldn't send the verification code. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
