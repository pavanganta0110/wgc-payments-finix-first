import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { generateMfaCode, hashMfaCode, MFA_CODE_TTL_MINUTES, MFA_MAX_CODE_ATTEMPTS } from "@/lib/auth/mfaCode";
import type { PartnerEmbedLinkPayload } from "@/lib/partners/embedLink";

/**
 * The email passcode a staff member enters once when they open an organization's dashboard
 * inside a partner's frame. The signed embed link says who the partner thinks the person is;
 * the code proves they can read that person's email. Once it is accepted the normal embedded
 * session lasts until it expires, so the code is asked once per session, not on every open.
 */

export const EMBED_PASSCODE_RESEND_COOLDOWN_SECONDS = 60;
export const EMBED_PASSCODE_MAX_SENDS_PER_HOUR = 5;

const EMBED_ROLES = ["owner", "admin", "fundraiser", "viewer"];

export interface EmbedUser {
  id: string;
  email: string;
  role: string;
  churchId: string;
  authVersion: number;
}

/** The organization (by the partner's own reference) and the person on its team. Null when either is missing or the person is disabled. */
export async function findEmbedUser(payload: PartnerEmbedLinkPayload): Promise<EmbedUser | null> {
  const church = await prisma.church.findFirst({
    where: { partnerId: payload.partnerId, partnerReference: payload.reference },
    select: { id: true },
  });
  if (!church) return null;

  const user = await prisma.user.findFirst({
    where: payload.email
      ? { churchId: church.id, email: payload.email, role: { in: EMBED_ROLES } }
      : { churchId: church.id, role: "owner" },
    select: { id: true, email: true, role: true, churchId: true, authVersion: true, disabledAt: true },
  });
  if (!user || !user.churchId || user.disabledAt) return null;
  return { id: user.id, email: user.email, role: user.role, churchId: user.churchId, authVersion: user.authVersion };
}

export function maskEmail(email: string): string {
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

export type IssuePasscodeResult = { status: "sent"; code: string } | { status: "cooldown"; retryAfterSeconds: number } | { status: "limited" };

/** Creates a new code (replacing any earlier unused one) unless the person asked too recently or too often. The caller emails it. */
export async function issueEmbedPasscode(user: Pick<EmbedUser, "id" | "churchId">, now: Date = new Date()): Promise<IssuePasscodeResult> {
  const last = await prisma.partnerEmbedPasscode.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last) {
    const seconds = (now.getTime() - last.createdAt.getTime()) / 1000;
    if (seconds < EMBED_PASSCODE_RESEND_COOLDOWN_SECONDS) return { status: "cooldown", retryAfterSeconds: Math.ceil(EMBED_PASSCODE_RESEND_COOLDOWN_SECONDS - seconds) };
  }
  const lastHour = await prisma.partnerEmbedPasscode.count({ where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - 60 * 60 * 1000) } } });
  if (lastHour >= EMBED_PASSCODE_MAX_SENDS_PER_HOUR) return { status: "limited" };

  await prisma.partnerEmbedPasscode.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  const { code, codeHash } = generateMfaCode();
  await prisma.partnerEmbedPasscode.create({
    data: { userId: user.id, churchId: user.churchId, codeHash, expiresAt: new Date(now.getTime() + MFA_CODE_TTL_MINUTES * 60 * 1000) },
  });
  return { status: "sent", code };
}

/**
 * True when the code is the person's current one. Every guess is counted before it is compared
 * (atomically), so parallel requests cannot get more than MFA_MAX_CODE_ATTEMPTS tries, and a
 * correct code is claimed once. A wrong, expired, used or exhausted code all look the same.
 */
export async function verifyEmbedPasscode(userId: string, code: string, now: Date = new Date()): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const row = await prisma.partnerEmbedPasscode.findFirst({
    where: { userId, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true },
  });
  if (!row) return false;

  const counted = await prisma.partnerEmbedPasscode.updateMany({
    where: { id: row.id, usedAt: null, attempts: { lt: MFA_MAX_CODE_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (counted.count !== 1) return false;

  const expected = Buffer.from(row.codeHash, "hex");
  const actual = Buffer.from(hashMfaCode(code), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return false;

  const claimed = await prisma.partnerEmbedPasscode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  return claimed.count === 1;
}
