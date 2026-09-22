import { prisma } from "@/lib/prisma";
import { withApiAuth } from "@/lib/api/withApiAuth";
import { apiSuccess, apiError } from "@/lib/api/response";
import { getCampaignRaisedCents } from "@/lib/campaigns/campaignTotals";

export const GET = withApiAuth<{ params: Promise<{ campaignId: string }> }>("campaigns:read", async (req, auth, requestId, { params }) => {
  const { campaignId } = await params;

  const campaign = await prisma.fundraisingCampaign.findFirst({ where: { id: campaignId, churchId: auth.churchId } });
  if (!campaign) return apiError("not_found_error", "Campaign not found.", requestId);

  const raisedCents = await getCampaignRaisedCents(auth.churchId, campaign.id);
  return apiSuccess({ ...campaign, raisedCents }, requestId);
});
