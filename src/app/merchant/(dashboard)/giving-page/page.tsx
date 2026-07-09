import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import GivingPagesManager from "@/components/merchant/GivingPagesManager";

export default async function GivingPagePage() {
  const session = await getSession();
  const churchId = session!.churchId!;

  const church = await prisma.church.findUnique({ where: { id: churchId } });

  let pages = await prisma.givingPage.findMany({
    where: { churchId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  if (pages.length === 0 && church) {
    const defaultPage = await prisma.givingPage.create({
      data: {
        churchId,
        slug: church.slug,
        name: "General Giving",
        isDefault: true,
        enabled: false,
        headline: `Give to ${church.name}`,
        suggestedAmountsJson: [2500, 5000, 10000, 25000, 50000, 100000],
      },
    });
    pages = [defaultPage];
  }

  const givingPageTransfers = await prisma.finixTransfer.findMany({
    where: { churchId, source: "wgc_giving_page", state: "SUCCEEDED" },
  });
  const totalRaisedCents = givingPageTransfers.reduce((sum, t) => sum + (t.amountCents ?? 0), 0);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://wgcpayments.com";

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-900">Giving Page</h2>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Giving Page Activity</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-500 mb-1">Gifts via Giving Pages</p>
            <p className="text-2xl font-bold text-slate-900">{givingPageTransfers.length}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500 mb-1">Total Raised</p>
            <p className="text-2xl font-bold text-slate-900">{formatCents(totalRaisedCents)}</p>
          </div>
        </div>
        {givingPageTransfers.length === 0 && (
          <p className="text-xs text-slate-400 mt-4">
            No gifts have come through a giving page yet — this updates automatically as gifts come in.
          </p>
        )}
        <a
          href="/demo/donation"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center mt-4 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Preview the WGC demo giving experience
        </a>
      </div>

      <GivingPagesManager initialPages={pages} appUrl={appUrl} />
    </div>
  );
}
