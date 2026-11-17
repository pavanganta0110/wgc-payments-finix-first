import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAuditLog } from "@/lib/audit";
import { isAuthError } from "@/lib/auth/errors";
import { requirePartnerAdminWriteSession } from "@/lib/partners/partnerSession";
import { isValidAgentEmail } from "@/lib/partners/agents";

/** Renames an agent, changes their email, or turns them off. A turned-off agent's link stops tagging and they stop getting emails; their past organizations and reports stay. */
export async function PATCH(req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const session = await requirePartnerAdminWriteSession();
    const { agentId } = await params;
    const agent = await prisma.partnerAgent.findUnique({ where: { id: agentId }, select: { id: true, partnerId: true } });
    // Another partner's agent looks the same as a missing one.
    if (!agent || agent.partnerId !== session.partnerId) return NextResponse.json({ error: "Agent not found." }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const data: { name?: string; email?: string; disabledAt?: Date | null } = {};
    if ("name" in body) {
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
      if (!name) return NextResponse.json({ error: "Enter the agent's name." }, { status: 400 });
      data.name = name;
    }
    if ("email" in body) {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!isValidAgentEmail(email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      data.email = email;
    }
    if ("disabled" in body) {
      if (typeof body.disabled !== "boolean") return NextResponse.json({ error: "disabled must be true or false." }, { status: 400 });
      data.disabledAt = body.disabled ? new Date() : null;
    }
    if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

    await prisma.partnerAgent.update({ where: { id: agent.id }, data });
    await createAuditLog({ action: "PARTNER_AGENT_UPDATED", actorEmail: session.email, metadata: { partnerId: session.partnerId, agentId: agent.id, fields: Object.keys(data) } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
