import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { checkMerchantAuthRateLimit } from "@/lib/auth/merchantAuthRateLimit";
import { completeMerchantLogin } from "@/lib/auth/completeMerchantLogin";
import { hashMfaCode, MFA_MAX_CODE_ATTEMPTS } from "@/lib/auth/mfaCode";

/**
 * Second step of a login for a user with mfaEnabled — takes the opaque
 * challengeId returned by /api/merchant/login and the code texted to
 * their phone. Never accepts or trusts a userId from the client; the
 * challengeId is the only handle, and it's a random 32-byte token, not
 * anything derived from or guessable off the user's identity.
 */
export async function POST(req: Request) {
  try {
    const { challengeId, code } = await req.json();
    if (!challengeId || !code) {
      return NextResponse.json({ error: "Missing verification code." }, { status: 400 });
    }

    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    // Same per-IP window as the password login step — on top of the
    // per-challenge attempt cap below, so this isn't the only thing
    // standing between an attacker and brute-forcing a 6-digit code.
    if (!checkMerchantAuthRateLimit(`merchant-mfa-verify:${ip}`)) {
      return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
    }

    const user = await prisma.user.findFirst({ where: { mfaLoginChallengeId: challengeId } });
    if (!user || !user.mfaCodeHash || !user.mfaCodeExpiresAt) {
      return NextResponse.json({ error: "This verification code has expired. Please log in again." }, { status: 400 });
    }
    if (user.mfaCodeExpiresAt < new Date()) {
      await clearMfaChallenge(user.id);
      return NextResponse.json({ error: "This verification code has expired. Please log in again." }, { status: 400 });
    }
    if (user.mfaCodeAttempts >= MFA_MAX_CODE_ATTEMPTS) {
      await clearMfaChallenge(user.id);
      return NextResponse.json({ error: "Too many incorrect attempts. Please log in again to get a new code." }, { status: 400 });
    }

    if (hashMfaCode(String(code)) !== user.mfaCodeHash) {
      await prisma.user.update({ where: { id: user.id }, data: { mfaCodeAttempts: { increment: 1 } } });
      return NextResponse.json({ error: "Incorrect code. Please try again." }, { status: 400 });
    }

    if (user.disabledAt) {
      return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
    }

    await clearMfaChallenge(user.id);
    await completeMerchantLogin(user);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("MFA verification failed:", error);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}

async function clearMfaChallenge(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { mfaCodeHash: null, mfaCodeExpiresAt: null, mfaCodeAttempts: 0, mfaLoginChallengeId: null },
  });
}
