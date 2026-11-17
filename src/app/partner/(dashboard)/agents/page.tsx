import { redirect } from "next/navigation";
import PartnerAgentsPanel from "@/components/partner/PartnerAgentsPanel";
import { getPartnerSession } from "@/lib/partners/partnerSession";

export const metadata = { title: "Agents | Partner dashboard" };

export default async function PartnerAgentsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Agents</h2>
        <p className="text-sm text-slate-500 mt-1">The people who refer organizations to you. Reports are broken out by agent.</p>
      </div>
      <PartnerAgentsPanel canEdit={session.role === "ADMIN" && !session.readOnly} />
    </div>
  );
}
