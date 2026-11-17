import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { isAuthError } from "@/lib/auth/errors";
import { requirePartnerSession, requirePartnerAdminWriteSession } from "@/lib/partners/partnerSession";
import { generateAgentCode, isValidAgentEmail } from "@/lib/partners/agents";
import { ensureOnboardingCode } from "@/lib/partners/onboardingCode";

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://www.wgcpayments.com").replace(/\/+$/, "");
}

/** The signed-in partner's agents, each with the Get Started link that tags an application to them. */
export async function GET() {
  try {
    const session = await requirePartnerSession();
    const [agents, counts, partnerCode] = await Promise.all([
      prisma.partnerAgent.findMany({ where: { partnerId: session.partnerId }, orderBy: { createdAt: "asc" } }),
      prisma.church.groupBy({ by: ["partnerAgentId"], where: { partnerId: session.partnerId, partnerAgentId: { not: null } }, _count: { _all: true } }),
      ensureOnboardingCode(session.partnerId),
    ]);
    const byAgent = new Map(counts.map((c) => [c.partnerAgentId, c._count._all]));
    return NextResponse.json({
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        disabled: Boolean(a.disabledAt),
        organizations: byAgent.get(a.id) ?? 0,
        link: `${appBase()}/start?partner=${partnerCode}&agent=${a.code}`,
      })),
    });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** Adds an agent. The agent gets a copy of the status emails for the organizations they refer. */
export async function POST(req: Request) {
  try {
    const session = await requirePartnerAdminWriteSession();
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!name) return NextResponse.json({ error: "Enter the agent's name." }, { status: 400 });
    if (!isValidAgentEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    const dupe = await prisma.partnerAgent.findFirst({ where: { partnerId: session.partnerId, email, disabledAt: null }, select: { id: true } });
    if (dupe) return NextResponse.json({ error: "An agent with that email already exists." }, { status: 409 });

    const agent = await prisma.partnerAgent.create({ data: { partnerId: session.partnerId, name, email, code: generateAgentCode() } });
    await createAuditLog({ action: "PARTNER_AGENT_CREATED", actorEmail: session.email, metadata: { partnerId: session.partnerId, agentId: agent.id } });
    return NextResponse.json({ id: agent.id }, { status: 201 });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
