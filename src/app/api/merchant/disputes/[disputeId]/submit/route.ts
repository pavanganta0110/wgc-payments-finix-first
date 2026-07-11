import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { logDashboardAction } from "@/lib/dashboardAudit";

// See evidence/route.ts — "church_owner" isn't an issuable role yet, dropped.
const CAN_MANAGE_EVIDENCE = new Set(["church_admin"]);

export async function POST(req: Request, { params }: { params: Promise<{ disputeId: string }> }) {
  const session = await getSession();
  if (!session || !session.churchId || !CAN_MANAGE_EVIDENCE.has(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { disputeId } = await params;
  const dispute = await prisma.finixDispute.findFirst({
    where: { finixDisputeId: disputeId, churchId: session.churchId },
    include: { evidence: true },
  });
  if (!dispute) {
    return NextResponse.json({ error: "Dispute not found" }, { status: 404 });
  }
  if (dispute.respondedAt) {
    return NextResponse.json({ error: "This dispute's response has already been submitted." }, { status: 409 });
  }
  if (dispute.evidence.length === 0) {
    return NextResponse.json({ error: "Upload at least one piece of evidence before submitting." }, { status: 400 });
  }

  try {
    await finixClient.submitDisputeResponse(dispute.finixDisputeId);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit dispute response" }, { status: 502 });
  }

  const respondedAt = new Date();
  await prisma.$transaction([
    prisma.finixDispute.update({
      where: { id: dispute.id },
      data: { respondedAt },
    }),
    prisma.disputeEvidence.updateMany({
      where: { disputeId: dispute.id, submittedAt: null },
      data: { submittedAt: respondedAt },
    }),
  ]);

  await logDashboardAction({
    churchId: session.churchId,
    actorUserId: session.userId,
    actorEmail: session.email,
    actorRole: session.role,
    action: "dispute.response_submitted",
    entityType: "dispute",
    entityId: dispute.finixDisputeId,
    metadata: { evidenceCount: dispute.evidence.length },
    req,
  });

  return NextResponse.json({ success: true });
}
