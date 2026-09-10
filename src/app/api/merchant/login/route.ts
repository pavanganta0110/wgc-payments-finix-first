import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { checkMerchantAuthRateLimit } from "@/lib/auth/merchantAuthRateLimit";
import { completeMerchantLogin } from "@/lib/auth/completeMerchantLogin";
import { generateMfaCode, generateMfaChallengeId, maskPhone, MFA_CODE_TTL_MINUTES } from "@/lib/auth/mfaCode";
import { getSmsProvider } from "@/lib/sms/smsProvider";

export async function POST(req: Request) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!checkMerchantAuthRateLimit(`merchant-login:${ip}`)) {
      return NextResponse.json({ error: "Too many attempts. Please try again in a minute." }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    // Team-access Checkpoint 1: previously missing entirely — a disabled
    // user's password still worked, they just happened to fail every
    // permission check post-login. Reject at the door instead.
    if (user.disabledAt) {
      return NextResponse.json({ error: "This account has been disabled." }, { status: 403 });
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    if (user.mfaEnabled) {
      if (!user.phone) {
        // Shouldn't happen (enrollment always sets both together), but
        // fail toward "let support sort it out" rather than locking the
        // user out with no code ever sendable.
        console.error(`MFA enabled with no phone on file for user ${user.id}`);
        return NextResponse.json({ error: "Two-factor setup is incomplete on this account. Contact WGC Payments Support." }, { status: 500 });
      }
      const { code, codeHash } = generateMfaCode();
      const challengeId = generateMfaChallengeId();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          mfaCodeHash: codeHash,
          mfaCodeExpiresAt: new Date(Date.now() + MFA_CODE_TTL_MINUTES * 60 * 1000),
          mfaCodeAttempts: 0,
          mfaLoginChallengeId: challengeId,
        },
      });
      const smsResult = await getSmsProvider().send(user.phone, `Your WGC Payments verification code is ${code}. It expires in ${MFA_CODE_TTL_MINUTES} minutes.`);
      if (!smsResult.success) {
        console.error(`Failed to send MFA login code to user ${user.id}:`, smsResult.error);
        return NextResponse.json({ error: "Couldn't send your verification code. Please try again in a moment." }, { status: 502 });
      }
      return NextResponse.json({ mfaRequired: true, challengeId, maskedPhone: maskPhone(user.phone) });
    }

    await completeMerchantLogin(user);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Church login failed:", error);
    return NextResponse.json({ error: "Login failed. Please try again." }, { status: 500 });
  }
}
