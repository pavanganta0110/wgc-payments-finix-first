import PartnerReportsPanel from "@/components/partner/PartnerReportsPanel";

export const metadata = { title: "Reports | Partner dashboard" };

export default function PartnerReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Reports</h2>
        <p className="text-sm text-slate-500 mt-1">Download CSVs broken out by agent.</p>
      </div>
      <PartnerReportsPanel />
    </div>
  );
}
