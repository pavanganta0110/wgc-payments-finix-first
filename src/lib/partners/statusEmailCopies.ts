import { prisma } from "@/lib/prisma";

export interface StatusEmailRouting {
  /** The partner turned off WGC's own status emails to the organization. */
  suppressMerchant: boolean;
  /** Who else gets each status email: the partner's inboxes and the referring agent. */
  copies: string[];
}

/** Lower-cased, de-duplicated, and without the address the email already goes to. */
export function uniqueCopies(candidates: Array<string | null | undefined>, primary?: string | null): string[] {
  const skip = (primary ?? "").trim().toLowerCase();
  const seen = new Set<string>();
  for (const raw of candidates) {
    const email = (raw ?? "").trim().toLowerCase();
    if (email && email !== skip) seen.add(email);
  }
  return [...seen];
}

/**
 * Where an application's status emails go besides the organization: the partner's configured
 * inboxes (for example a team inbox that opens a case) and the agent who referred it. Reads only;
 * the caller decides what to do with it, and treats a failure here as "no copies".
 */
export async function loadStatusEmailRouting(applicationId: string, primaryEmail?: string | null): Promise<StatusEmailRouting> {
  const app = await prisma.onboardingApplication.findUnique({
    where: { id: applicationId },
    select: { partnerId: true, partnerAgentId: true },
  });
  if (!app?.partnerId) return { suppressMerchant: false, copies: [] };

  const [partner, agent] = await Promise.all([
    prisma.partner.findUnique({ where: { id: app.partnerId }, select: { suppressMerchantEmails: true, statusEmailRecipients: true } }),
    app.partnerAgentId
      ? prisma.partnerAgent.findUnique({ where: { id: app.partnerAgentId }, select: { email: true, disabledAt: true, partnerId: true } })
      : Promise.resolve(null),
  ]);
  const agentEmail = agent && !agent.disabledAt && agent.partnerId === app.partnerId ? agent.email : null;
  return {
    suppressMerchant: partner?.suppressMerchantEmails === true,
    copies: uniqueCopies([...(partner?.statusEmailRecipients ?? []), agentEmail], primaryEmail),
  };
}
