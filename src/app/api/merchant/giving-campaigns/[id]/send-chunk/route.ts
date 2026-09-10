import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { getDonorPermissions } from "@/lib/donors/donorPermissions";
import { renderCampaignTemplate } from "@/lib/giving/campaignTemplate";
import { sendWgcEmail } from "@/lib/email";
import { logDashboardAction } from "@/lib/dashboardAudit";

// Same chunk size as bulkStatementJobs.ts — small enough that one call
// finishes well within a serverless request timeout, driven by the
// frontend calling this repeatedly (same "create job, process N at a
// time" shape already established there) until every recipient is done.
const SEND_CHUNK_SIZE = 5;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const permissions = getDonorPermissions(auth.rawRole);
  if (!permissions.canView || !permissions.canSendStatements) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const campaign = await prisma.givingCampaign.findFirst({ where: { id, churchId: auth.churchId } });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
  }
  if (campaign.status === "SENT") {
    return NextResponse.json({ done: true, campaign });
  }

  const church = await prisma.church.findUnique({ where: { id: auth.churchId }, select: { name: true } });
  const churchName = church?.name || "Your Organization";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://wgcpayments.com";

  const pending = await prisma.givingCampaignRecipient.findMany({
    where: { campaignId: campaign.id, churchId: auth.churchId, sendStatus: "PENDING" },
    take: SEND_CHUNK_SIZE,
  });

  if (campaign.status === "DRAFT" && pending.length > 0) {
    await prisma.givingCampaign.update({ where: { id: campaign.id }, data: { status: "SENDING" } });
  }

  for (const recipient of pending) {
    if (!recipient.recipientEmail) {
      await prisma.givingCampaignRecipient.update({ where: { id: recipient.id }, data: { sendStatus: "FAILED", sendError: "No email on file" } });
      continue;
    }
    const vars = {
      firstName: recipient.recipientName?.split(" ")[0] || "there",
      churchName,
      link: `${appUrl}/gc/${recipient.trackingToken}`,
    };
    const subject = renderCampaignTemplate(campaign.emailSubject || "", vars);
    const bodyHtml = renderCampaignTemplate(campaign.emailBodyTemplate || "", vars);

    const result = await sendWgcEmail({
      to: recipient.recipientEmail,
      subject,
      title: subject,
      badgeText: `A message from ${churchName}`,
      badgeColor: "#0B5DBC",
      bodyHtml,
      log: {
        churchId: auth.churchId,
        donorId: recipient.donorId,
        recipientName: recipient.recipientName,
        category: "MERCHANT_NOTIFICATION",
        relatedEntityType: "GivingCampaignRecipient",
        relatedEntityId: recipient.id,
        createdByUserId: auth.userId,
      },
    });

    await prisma.givingCampaignRecipient.update({
      where: { id: recipient.id },
      data: result.success
        ? { sendStatus: "SENT", sentAt: new Date() }
        : { sendStatus: "FAILED", sendError: result.error ? String(result.error) : "Send failed" },
    });
  }

  const remaining = await prisma.givingCampaignRecipient.count({
    where: { campaignId: campaign.id, churchId: auth.churchId, sendStatus: "PENDING" },
  });
  const done = remaining === 0;

  const updated = done
    ? await prisma.givingCampaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentAt: new Date() } })
    : campaign;

  if (done) {
    await logDashboardAction({
      churchId: auth.churchId,
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.rawRole,
      action: "giving_campaign.sent",
      entityType: "GivingCampaign",
      entityId: campaign.id,
      req,
    });
  }

  return NextResponse.json({ done, processed: pending.length, remaining, campaign: updated });
}
