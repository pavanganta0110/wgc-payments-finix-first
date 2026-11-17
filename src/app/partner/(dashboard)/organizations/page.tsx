import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partners/partnerSession";
import { prisma } from "@/lib/prisma";
import OrganizationAgentSelect from "@/components/partner/OrganizationAgentSelect";
import { loadPartnerOrganizations } from "@/lib/partners/loadPartnerOrganizations";

export const metadata = { title: "Organizations | Partner dashboard" };

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export default async function PartnerOrganizationsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const orgs = await loadPartnerOrganizations(session.partnerId);
  const agents = await prisma.partnerAgent.findMany({ where: { partnerId: session.partnerId, disabledAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const canEditAgent = session.role === "ADMIN" && !session.readOnly;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Organizations</h2>
        <p className="text-sm text-slate-500 mt-1">
          {orgs.length === 0 ? "No organizations are linked to your account yet." : `${orgs.length} organization${orgs.length === 1 ? "" : "s"} linked to your account.`}
        </p>
      </div>

      {orgs.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
                <th className="px-4 py-3 font-semibold">Organization</th>
                <th className="px-4 py-3 font-semibold">Your reference</th>
                <th className="px-4 py-3 font-semibold">Agent</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Gifts</th>
                <th className="px-4 py-3 font-semibold text-right">Volume</th>
                <th className="px-4 py-3 font-semibold">Last gift</th>
                <th className="px-4 py-3 font-semibold">Added</th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-slate-900">{o.name}</td>
                  <td className="px-4 py-3 text-slate-600">{o.reference ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {canEditAgent ? <OrganizationAgentSelect churchId={o.id} agentId={o.agentId} agentName={o.agentName} agents={agents} /> : (o.agentName ?? "—")}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.status === "ACTIVE" ? "Active" : "Terminated"}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{o.giftCount.toLocaleString("en-US")}</td>
                  <td className="px-4 py-3 text-right text-slate-900">{usd.format(o.giftTotalCents / 100)}</td>
                  <td className="px-4 py-3 text-slate-600">{o.lastGiftAt ? dateFmt.format(o.lastGiftAt) : "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{dateFmt.format(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
