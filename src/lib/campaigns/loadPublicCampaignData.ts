import { prisma } from "@/lib/prisma";
import { getCampaignRaisedCents, getTeamRaisedCents, getFundraiserRaisedCents, getRecentGifts, getDonorCount } from "@/lib/campaigns/campaignTotals";

interface CampaignPublicView {
  kind: "campaign";
  campaign: NonNullable<Awaited<ReturnType<typeof prisma.fundraisingCampaign.findUnique>>>;
  church: { name: string; logoUrl: string | null };
  giveHref: string | null;
  raisedCents: number;
  donorCount: number;
  recentGifts: Awaited<ReturnType<typeof getRecentGifts>>;
}

interface TeamPublicView {
  kind: "team";
  team: NonNullable<Awaited<ReturnType<typeof prisma.campaignTeam.findUnique>>>;
  campaign: NonNullable<Awaited<ReturnType<typeof prisma.fundraisingCampaign.findUnique>>>;
  church: { name: string; logoUrl: string | null };
  giveHref: string | null;
  raisedCents: number;
  donorCount: number;
  recentGifts: Awaited<ReturnType<typeof getRecentGifts>>;
}

interface FundraiserPublicView {
  kind: "fundraiser";
  fundraiser: NonNullable<Awaited<ReturnType<typeof prisma.campaignFundraiser.findUnique>>>;
  campaign: NonNullable<Awaited<ReturnType<typeof prisma.fundraisingCampaign.findUnique>>>;
  church: { name: string; logoUrl: string | null };
  giveHref: string | null;
  raisedCents: number;
  donorCount: number;
  recentGifts: Awaited<ReturnType<typeof getRecentGifts>>;
}

type PublicView = CampaignPublicView | TeamPublicView | FundraiserPublicView;
export type PublicCampaignResult = { ok: false } | { ok: true; view: PublicView };

async function loadGiveHref(givingLinkId: string | null): Promise<string | null> {
  if (!givingLinkId) return null;
  const link = await prisma.givingLink.findUnique({ where: { id: givingLinkId }, select: { publicSlug: true } });
  return link ? `/g/${link.publicSlug}` : null;
}

export async function loadPublicCampaignBySlug(slug: string): Promise<PublicCampaignResult> {
  const campaign = await prisma.fundraisingCampaign.findUnique({ where: { slug } });
  if (!campaign || campaign.status !== "ACTIVE" || campaign.archivedAt) return { ok: false };

  const church = await prisma.church.findUnique({ where: { id: campaign.churchId }, select: { name: true, logoUrl: true } });
  if (!church) return { ok: false };

  const [raisedCents, donorCount, recentGifts, giveHref] = await Promise.all([
    getCampaignRaisedCents(campaign.churchId, campaign.id),
    getDonorCount(campaign.churchId, { fundraisingCampaignId: campaign.id }),
    getRecentGifts(campaign.churchId, { fundraisingCampaignId: campaign.id }, 20),
    loadGiveHref(campaign.givingLinkId),
  ]);

  return { ok: true, view: { kind: "campaign", campaign, church, giveHref, raisedCents, donorCount, recentGifts } };
}

export async function loadPublicTeamBySlug(slug: string): Promise<PublicCampaignResult> {
  const team = await prisma.campaignTeam.findUnique({ where: { slug } });
  if (!team) return { ok: false };

  const campaign = await prisma.fundraisingCampaign.findUnique({ where: { id: team.fundraisingCampaignId } });
  if (!campaign || campaign.status !== "ACTIVE" || campaign.archivedAt) return { ok: false };

  const church = await prisma.church.findUnique({ where: { id: team.churchId }, select: { name: true, logoUrl: true } });
  if (!church) return { ok: false };

  const [raisedCents, donorCount, recentGifts, giveHref] = await Promise.all([
    getTeamRaisedCents(team.churchId, team.id),
    getDonorCount(team.churchId, { campaignTeamId: team.id }),
    getRecentGifts(team.churchId, { campaignTeamId: team.id }, 20),
    loadGiveHref(team.givingLinkId),
  ]);

  return { ok: true, view: { kind: "team", team, campaign, church, giveHref, raisedCents, donorCount, recentGifts } };
}

export async function loadPublicFundraiserBySlug(slug: string): Promise<PublicCampaignResult> {
  const fundraiser = await prisma.campaignFundraiser.findUnique({ where: { slug } });
  if (!fundraiser) return { ok: false };

  const campaign = await prisma.fundraisingCampaign.findUnique({ where: { id: fundraiser.fundraisingCampaignId } });
  if (!campaign || campaign.status !== "ACTIVE" || campaign.archivedAt) return { ok: false };

  const church = await prisma.church.findUnique({ where: { id: fundraiser.churchId }, select: { name: true, logoUrl: true } });
  if (!church) return { ok: false };

  const [raisedCents, donorCount, recentGifts, giveHref] = await Promise.all([
    getFundraiserRaisedCents(fundraiser.churchId, fundraiser.id),
    getDonorCount(fundraiser.churchId, { campaignFundraiserId: fundraiser.id }),
    getRecentGifts(fundraiser.churchId, { campaignFundraiserId: fundraiser.id }, 20),
    loadGiveHref(fundraiser.givingLinkId),
  ]);

  return { ok: true, view: { kind: "fundraiser", fundraiser, campaign, church, giveHref, raisedCents, donorCount, recentGifts } };
}
