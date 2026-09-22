import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { loadPublicCampaignBySlug } from "@/lib/campaigns/loadPublicCampaignData";
import LiveDonationWall from "@/components/campaigns/LiveDonationWall";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const campaign = await prisma.fundraisingCampaign.findUnique({ where: { slug } });
  if (!campaign) return {};
  return {
    title: `${campaign.name} — Live Donation Wall`,
    robots: { index: false, follow: false },
  };
}

export default async function CampaignWallPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await loadPublicCampaignBySlug(slug);
  if (!result.ok || result.view.kind !== "campaign") notFound();

  const { campaign, church, raisedCents, donorCount, recentGifts } = result.view;

  return (
    <LiveDonationWall
      slug={slug}
      initial={{
        name: campaign.name,
        organizationName: church.name,
        logoUrl: church.logoUrl,
        imageUrl: campaign.imageUrl,
        goalAmountCents: campaign.goalAmountCents,
        raisedCents,
        donorCount,
        recentGifts: recentGifts.map((g) => ({
          id: g.id,
          amountCents: g.amountCents,
          donorName: g.donorName ?? "Anonymous",
          message: g.message,
          createdAt: g.createdAt.toISOString(),
        })),
      }}
    />
  );
}
