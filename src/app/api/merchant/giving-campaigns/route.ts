import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { isAuthError } from "@/lib/auth/errors";
import { getDonorPermissions } from "@/lib/donors/donorPermissions";
import { generateCampaignTrackingToken } from "@/lib/giving/campaignTemplate";
import { logDashboardAction } from "@/lib/dashboardAudit";
import { isSmsConfigured } from "@/lib/sms/sendText";
import { isSmsAddonActive } from "@/lib/billing/smsAddonSubscriptionService";

const CHANNELS = new Set(["EMAIL", "TEXT"]);

/** List this church's campaigns, most recent first, with a lightweight
 * recipient-status rollup (no per-recipient rows — see [id]/route.ts for
 * that) so the list page doesn't pull every recipient for every campaign. */
export async function GET() {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  if (!getDonorPermissions(auth.rawRole).canView) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaigns = await prisma.givingCampaign.findMany({
    where: { churchId: auth.churchId },
    orderBy: { createdAt: "desc" },
  });

  const counts = await prisma.givingCampaignRecipient.groupBy({
    by: ["campaignId", "sendStatus"],
    where: { churchId: auth.churchId, campaignId: { in: campaigns.map((c) => c.id) } },
    _count: true,
  });
  const paidCounts = await prisma.givingCampaignRecipient.groupBy({
    by: ["campaignId"],
    where: { churchId: auth.churchId, campaignId: { in: campaigns.map((c) => c.id) }, paidAt: { not: null } },
    _count: true,
  });

  const result = campaigns.map((c) => {
    const forCampaign = counts.filter((row) => row.campaignId === c.id);
    const total = forCampaign.reduce((sum, row) => sum + row._count, 0);
    const sent = forCampaign.filter((row) => row.sendStatus === "SENT").reduce((sum, row) => sum + row._count, 0);
    const failed = forCampaign.filter((row) => row.sendStatus === "FAILED").reduce((sum, row) => sum + row._count, 0);
    const paid = paidCounts.find((row) => row.campaignId === c.id)?._count ?? 0;
    return { ...c, recipientCounts: { total, sent, failed, paid } };
  });

  return NextResponse.json({ campaigns: result });
}

/** Creates a DRAFT campaign and seeds one GivingCampaignRecipient per
 * requested donor. Never sends anything — see [id]/send-chunk/route.ts. A
 * donor missing the contact info the chosen channel needs (email for
 * EMAIL, a US-parseable phone for TEXT) is skipped silently, which is why
 * the response reports back how many of the requested donors actually
 * became real recipients. */
export async function POST(req: Request) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  const permissions = getDonorPermissions(auth.rawRole);
  // Sending a bulk message to the donor list is a donor-communication
  // action, not just viewing — same tier as generating/sending statements.
  if (!permissions.canView || !permissions.canSendStatements) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const givingLinkId = typeof body.givingLinkId === "string" ? body.givingLinkId : "";
  const channel = typeof body.channel === "string" && CHANNELS.has(body.channel) ? body.channel : "EMAIL";
  const emailSubject = typeof body.emailSubject === "string" ? body.emailSubject.trim() : "";
  const emailBodyTemplate = typeof body.emailBodyTemplate === "string" ? body.emailBodyTemplate : "";
  const textBodyTemplate = typeof body.textBodyTemplate === "string" ? body.textBodyTemplate.trim() : "";
  const donorIds: string[] = Array.isArray(body.donorIds) ? body.donorIds.filter((id: unknown) => typeof id === "string") : [];

  if (channel === "EMAIL" && (!emailSubject || !emailBodyTemplate)) {
    return NextResponse.json({ error: "A subject and message are required." }, { status: 400 });
  }
  if (channel === "TEXT" && !textBodyTemplate) {
    return NextResponse.json({ error: "A message is required." }, { status: 400 });
  }
  if (channel === "TEXT" && !isSmsConfigured()) {
    return NextResponse.json({ error: "Text messaging is not configured for this organization." }, { status: 400 });
  }
  if (channel === "TEXT" && !(await isSmsAddonActive(auth.churchId))) {
    return NextResponse.json({ error: "Text messaging is a paid add-on — subscribe from Billing Plan to send texts." }, { status: 402 });
  }
  if (!name || !givingLinkId) {
    return NextResponse.json({ error: "Name and giving link are required." }, { status: 400 });
  }
  if (donorIds.length === 0) {
    return NextResponse.json({ error: "Select at least one donor." }, { status: 400 });
  }

  const link = await prisma.givingLink.findFirst({ where: { id: givingLinkId, churchId: auth.churchId } });
  if (!link) {
    return NextResponse.json({ error: "Giving link not found." }, { status: 404 });
  }

  const donors =
    channel === "TEXT"
      ? await prisma.donor.findMany({
          where: { id: { in: donorIds }, churchId: auth.churchId, normalizedPhone: { not: null } },
          select: { id: true, name: true, normalizedPhone: true },
        })
      : await prisma.donor.findMany({
          where: { id: { in: donorIds }, churchId: auth.churchId, email: { not: null } },
          select: { id: true, name: true, email: true },
        });

  if (donors.length === 0) {
    return NextResponse.json(
      { error: channel === "TEXT" ? "None of the selected donors have a valid phone number on file." : "None of the selected donors have an email address on file." },
      { status: 400 }
    );
  }

  const campaign = await prisma.givingCampaign.create({
    data: {
      churchId: auth.churchId,
      givingLinkId: link.id,
      name,
      channel,
      emailSubject: channel === "EMAIL" ? emailSubject : null,
      emailBodyTemplate: channel === "EMAIL" ? emailBodyTemplate : null,
      textBodyTemplate: channel === "TEXT" ? textBodyTemplate : null,
      createdByUserId: auth.userId,
    },
  });

  await prisma.givingCampaignRecipient.createMany({
    data:
      channel === "TEXT"
        ? (donors as { id: string; name: string | null; normalizedPhone: string | null }[]).map((d) => ({
            campaignId: campaign.id,
            churchId: auth.churchId,
            donorId: d.id,
            trackingToken: generateCampaignTrackingToken(),
            recipientPhone: d.normalizedPhone,
            recipientName: d.name,
          }))
        : (donors as { id: string; name: string | null; email: string | null }[]).map((d) => ({
            campaignId: campaign.id,
            churchId: auth.churchId,
            donorId: d.id,
            trackingToken: generateCampaignTrackingToken(),
            recipientEmail: d.email,
            recipientName: d.name,
          })),
  });

  await logDashboardAction({
    churchId: auth.churchId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.rawRole,
    action: "giving_campaign.created",
    entityType: "GivingCampaign",
    entityId: campaign.id,
    metadata: { name, givingLinkId, channel, requestedCount: donorIds.length, recipientCount: donors.length },
    req,
  });

  return NextResponse.json({ campaign, recipientCount: donors.length, skippedCount: donorIds.length - donors.length }, { status: 201 });
}
