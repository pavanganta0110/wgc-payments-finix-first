import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { isAuthError } from "@/lib/auth/errors";
import { requirePartnerAdminWriteSession } from "@/lib/partners/partnerSession";

/** Sets (or clears, with agentId null) which of the partner's agents referred an organization. For merchants boarded before agents existed, or tagged to the wrong agent. */
export async function PUT(req: Request, { params }: { params: Promise<{ churchId: string }> }) {
  try {
    const session = await requirePartnerAdminWriteSession();
    const { churchId } = await params;
    const body = await req.json().catch(() => ({}));
    const agentId = body.agentId === null ? null : typeof body.agentId === "string" ? body.agentId : undefined;
    if (agentId === undefined) return NextResponse.json({ error: "agentId must be an agent id or null." }, { status: 400 });

    // partnerId comes from the session, never from the request.
    const church = await prisma.church.findFirst({ where: { id: churchId, partnerId: session.partnerId }, select: { id: true, onboardingApplicationId: true } });
    if (!church) return NextResponse.json({ error: "Organization not found." }, { status: 404 });
    if (agentId) {
      const agent = await prisma.partnerAgent.findFirst({ where: { id: agentId, partnerId: session.partnerId }, select: { id: true } });
      if (!agent) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
    }

    await prisma.church.update({ where: { id: church.id }, data: { partnerAgentId: agentId } });
    // Keep the application in step so later status emails go to the same agent.
    if (church.onboardingApplicationId) {
      await prisma.onboardingApplication.updateMany({ where: { id: church.onboardingApplicationId, partnerId: session.partnerId }, data: { partnerAgentId: agentId } });
    }
    await createAuditLog({ action: "PARTNER_ORG_AGENT_SET", actorEmail: session.email, metadata: { partnerId: session.partnerId, churchId: church.id, agentId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
