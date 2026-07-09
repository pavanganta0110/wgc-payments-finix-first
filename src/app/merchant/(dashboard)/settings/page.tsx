import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import SettingsForm from "@/components/merchant/SettingsForm";

export default async function SettingsPage() {
  const session = await getSession();
  const churchId = session!.churchId!;

  const church = await prisma.church.findUnique({ where: { id: churchId } });
  const onboarding = church?.onboardingApplicationId
    ? await prisma.onboardingApplication.findUnique({ where: { id: church.onboardingApplicationId } })
    : null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-900">Settings</h2>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Organization Details</h3>
        <SettingsForm initialName={church?.name || ""} initialEmail={church?.primaryContactEmail || ""} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Bank Account</h3>
        {onboarding?.bankLast4 ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <Row label="Bank Name" value={onboarding.bankName || "—"} />
            <Row label="Account Type" value={onboarding.bankAccountType || "—"} />
            <Row label="Account Number" value={`•••• ${onboarding.bankLast4}`} />
            <Row label="Currency" value={onboarding.bankCurrency || "USD"} />
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No bank account on file yet. This was set during onboarding and updating it requires WGC support.
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Account Status</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Row label="Status" value={church?.status || "—"} />
          <Row label="Merchant ID" value={church?.finixMerchantId || "—"} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="font-semibold text-slate-800">{value}</p>
    </div>
  );
}
