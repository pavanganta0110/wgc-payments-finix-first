import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * A partner's agents: the people who refer organizations to it. An agent's own Get Started
 * link carries `agent=<code>`, which tags the application. The code only labels; it never
 * grants access to anything.
 */

export function generateAgentCode(): string {
  return `ag_${crypto.randomBytes(12).toString("base64url")}`;
}

export function looksLikeAgentCode(value: unknown): value is string {
  return typeof value === "string" && /^ag_[A-Za-z0-9_-]{12,40}$/.test(value);
}

/**
 * The id of the active agent behind a code, only if the agent belongs to this partner (a code
 * from another partner is ignored). Null for anything unknown; a bad code never blocks an application.
 */
export async function resolveAgentIdForPartner(partnerId: string, code: unknown): Promise<string | null> {
  if (!looksLikeAgentCode(code)) return null;
  const agent = await prisma.partnerAgent.findUnique({ where: { code }, select: { id: true, partnerId: true, disabledAt: true } });
  if (!agent || agent.partnerId !== partnerId || agent.disabledAt) return null;
  return agent.id;
}

export function isValidAgentEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value);
}
