import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";

export default async function MerchantDashboardPage() {
  await requireMerchantSession();
  
  return (
    <div className="flex-1 w-full h-full min-h-[calc(100vh-100px)]">
      <iframe
        src="/walkthrough/index.html"
        className="w-full h-full border-none min-h-[800px]"
        title="WGC Giving Page Walkthrough"
      />
    </div>
  );
}
