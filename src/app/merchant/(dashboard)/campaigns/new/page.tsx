import { redirect } from "next/navigation";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { hasPermission } from "@/lib/auth/permissions";
import { isAuthError } from "@/lib/auth/errors";
import NewFundraisingCampaignForm from "@/components/merchant/NewFundraisingCampaignForm";

export default async function NewFundraisingCampaignPage() {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) redirect("/merchant/login");
    throw err;
  }
  if (!hasPermission(auth, "canCreateFundraisingCampaign")) redirect("/merchant/campaigns");

  return (
    <div>
      <h2 className="text-lg font-medium mb-6">New Fundraising Campaign</h2>
      <NewFundraisingCampaignForm />
    </div>
  );
}
