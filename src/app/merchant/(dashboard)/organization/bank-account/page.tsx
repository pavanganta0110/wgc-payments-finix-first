import { getSession } from "@/lib/auth/session";
import { getOrganizationPermissions } from "@/lib/organization/organizationPermissions";
import { loadOrganizationProfile } from "@/lib/organization/organizationProfileLoader";
import StateBadge from "@/components/merchant/StateBadge";
import RequestChangeButton from "@/components/merchant/RequestChangeButton";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export default async function OrganizationBankAccountPage() {
  const session = await getSession();
  const permissions = getOrganizationPermissions(session?.role);
  const profile = await loadOrganizationProfile(session!.churchId!);
  if (!profile) return null;
  const { onboarding } = profile;

  if (!onboarding || !onboarding.bankInstrumentId) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <p className="text-sm text-slate-500">No bank account is on file for this organization yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">Bank Account on File</h3>
          <StateBadge state={onboarding.bankInstrumentEnabled ? "ENABLED" : "DISABLED"} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <Row label="Bank Name" value={onboarding.bankName || "—"} />
          <Row label="Account Number" value={onboarding.bankLast4 ? `••••${onboarding.bankLast4}` : "—"} />
          <Row label="Account Type" value={onboarding.bankAccountType || "—"} />
          <Row label="Currency" value={onboarding.bankCurrency || "—"} />
        </div>
        <p className="text-xs text-slate-400 mt-4">Full account and routing numbers are never displayed here for security.</p>
      </div>

      {permissions.canUpdateBankAccount && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-2">Update Bank Account</h3>
          <p className="text-xs text-slate-500 mb-3">
            Bank account changes are reviewed by WGC Support to protect against fraud and keep deposits uninterrupted.
          </p>
          <RequestChangeButton area="BANK_ACCOUNT" label="Request Bank Account Update" />
        </div>
      )}
    </div>
  );
}
