import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { resolveDateRange } from "@/lib/dateRangePresets";
import TransactionsFilterBar from "@/components/merchant/TransactionsFilterBar";
import CopyableIdBadge from "@/components/merchant/CopyableIdBadge";
import ClickableTableRow from "@/components/merchant/ClickableTableRow";
import StateBadge from "@/components/merchant/StateBadge";
import { formatDateTime, formatDate } from "@/lib/formatCentralTime";

const STATES = ["SUCCEEDED", "FAILED", "PENDING", "CANCELED"];

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; range?: string; from?: string; to?: string }>;
}) {
  const session = await getSession();
  const churchId = session!.churchId!;
  const { state, range, from, to } = await searchParams;
  const { from: startDate, to: endDate } = resolveDateRange(range, from, to);
  const dateFilter = startDate ? { gte: startDate, ...(endDate ? { lte: endDate } : {}) } : undefined;

  const deposits = await prisma.finixFundingTransferAttempt.findMany({
    where: {
      churchId,
      ...(state ? { state } : {}),
      ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
    },
    orderBy: { createdAtFinix: "desc" },
    take: 100,
  });

  return (
    <div>
      <h2 className="text-lg font-bold text-slate-900 mb-6">Deposits</h2>

      <TransactionsFilterBar states={STATES} exportHref="/api/merchant/transactions/deposits/export" />

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-visible">
        {deposits.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            No bank deposits match these filters.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                <th className="px-6 py-3">ID</th>
                <th className="px-6 py-3">Sent</th>
                <th className="px-6 py-3">Bank Account</th>
                <th className="px-6 py-3">Settlement</th>
                <th className="px-6 py-3">Estimated Arrival</th>
                <th className="px-6 py-3">State</th>
                <th className="px-6 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => {
                const cells = (
                  <>
                    <td className="px-6 py-3">
                      <CopyableIdBadge id={d.finixFundingTransferAttemptId} />
                    </td>
                    <td className="px-6 py-3 text-slate-600 whitespace-nowrap">
                      {formatDateTime(d.sentAt ?? d.createdAtFinix)}
                    </td>
                    <td className="px-6 py-3 text-slate-600">
                      {d.bankAccountLast4 ? `•••• ${d.bankAccountLast4}` : "—"}
                    </td>
                    <td className="px-6 py-3">
                      {d.finixSettlementId ? (
                        <CopyableIdBadge id={d.finixSettlementId} label={d.finixSettlementId} variant="link" />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-6 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(d.estimatedArrivalDate)}
                    </td>
                    <td className="px-6 py-3">
                      <StateBadge state={d.state} />
                      {d.failureCode && <p className="text-xs text-slate-400 mt-0.5">{d.failureCode}</p>}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-slate-900">
                      {formatCents(d.amountCents ?? 0)}
                    </td>
                  </>
                );

                return d.finixSettlementId ? (
                  <ClickableTableRow
                    key={d.id}
                    id={d.finixSettlementId}
                    className="border-t border-slate-50 hover:bg-slate-50"
                    targetHref={`/merchant/settlements?id=${d.finixSettlementId}`}
                  >
                    {cells}
                  </ClickableTableRow>
                ) : (
                  <tr key={d.id} className="border-t border-slate-50">
                    {cells}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
