import { notFound, redirect } from "next/navigation";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { hasPermission } from "@/lib/auth/permissions";
import { isAuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import CampaignDetailClient from "@/components/merchant/CampaignDetailClient";

export default async function CampaignDetailPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) redirect("/merchant/login");
    throw err;
  }
  if (!hasPermission(auth, "canViewFundraisingCampaigns")) redirect("/merchant/dashboard");

  const campaign = await prisma.fundraisingCampaign.findFirst({
    where: { id: campaignId, churchId: auth.churchId },
  });
  if (!campaign) notFound();

  return (
    <CampaignDetailClient
      campaign={{
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        status: campaign.status,
        goalAmountCents: campaign.goalAmountCents,
        leaderboardEnabled: campaign.leaderboardEnabled,
      }}
      canEdit={hasPermission(auth, "canEditFundraisingCampaign")}
      canManageRoster={hasPermission(auth, "canManageCampaignRoster")}
      canArchive={hasPermission(auth, "canArchiveFundraisingCampaign")}
    />
  );
}
