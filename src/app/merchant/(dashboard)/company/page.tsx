import { Building2 } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import ComingSoon from "@/components/merchant/ComingSoon";

export default async function CompanyPage() {
  const session = await getSession();
  const churchId = session!.churchId!;

  const church = await prisma.church.findUnique({ where: { id: churchId } });
  const onboarding = church?.onboardingApplicationId
    ? await prisma.onboardingApplication.findUnique({
        where: { id: church.onboardingApplicationId },
        include: { associatedOwners: true },
      })
    : null;

  if (!onboarding) {
    return (
      <ComingSoon
        icon={Building2}
        title="Company"
        description="Legal business details, ownership, and compliance documents will be managed here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-900">Company</h2>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Legal Business Information</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Row label="Legal Business Name" value={onboarding.legalBusinessName || onboarding.organizationName} />
          <Row label="Doing Business As" value={onboarding.doingBusinessAs || "—"} />
          <Row label="Organization Type" value={onboarding.organizationType} />
          <Row label="Business Type" value={onboarding.businessType || "—"} />
          <Row label="Ownership Type" value={onboarding.ownershipType || "—"} />
          <Row label="MCC" value={onboarding.mcc || "—"} />
          <Row label="Website" value={onboarding.website || "—"} />
          <Row label="Business Phone" value={onboarding.businessPhone || "—"} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Business Address</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Row label="Address Line 1" value={onboarding.businessAddressLine1 || "—"} />
          <Row label="Address Line 2" value={onboarding.businessAddressLine2 || "—"} />
          <Row label="City" value={onboarding.businessCity || "—"} />
          <Row label="State" value={onboarding.businessState || "—"} />
          <Row label="Postal Code" value={onboarding.businessPostalCode || "—"} />
          <Row label="Country" value={onboarding.businessCountry || "—"} />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Principal</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Row
            label="Name"
            value={
              onboarding.principalFirstName || onboarding.principalLastName
                ? `${onboarding.principalFirstName ?? ""} ${onboarding.principalLastName ?? ""}`.trim()
                : "—"
            }
          />
          <Row label="Title" value={onboarding.principalTitle || "—"} />
          <Row label="Email" value={onboarding.principalEmail || "—"} />
          <Row label="Phone" value={onboarding.principalPhone || "—"} />
          <Row
            label="Ownership Percentage"
            value={onboarding.principalOwnershipPercentage != null ? `${onboarding.principalOwnershipPercentage}%` : "—"}
          />
        </div>
      </div>

      {onboarding.associatedOwners.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden max-w-2xl">
          <div className="px-6 py-4 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Other Owners</h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Email</th>
                <th className="px-6 py-3 text-right">Ownership</th>
              </tr>
            </thead>
            <tbody>
              {onboarding.associatedOwners.map((owner) => (
                <tr key={owner.id} className="border-t border-slate-50">
                  <td className="px-6 py-3 text-slate-700">
                    {owner.firstName} {owner.lastName}
                  </td>
                  <td className="px-6 py-3 text-slate-600">{owner.title || "—"}</td>
                  <td className="px-6 py-3 text-slate-600">{owner.email}</td>
                  <td className="px-6 py-3 text-right text-slate-600">
                    {owner.ownershipPercentage != null ? `${owner.ownershipPercentage}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
