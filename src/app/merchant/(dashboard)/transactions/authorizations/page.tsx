import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { resolveDateRange } from "@/lib/dateRangePresets";
import CopyableIdBadge from "@/components/merchant/CopyableIdBadge";
import ClickableTableRow from "@/components/merchant/ClickableTableRow";
import StateBadge from "@/components/merchant/StateBadge";
import { formatPersonName } from "@/lib/formatPersonName";
import AuthorizationDetailPanel from "@/components/merchant/AuthorizationDetailPanel";
import AuthorizationFilterBar from "@/components/merchant/AuthorizationFilterBar";

const STATES = ["SUCCEEDED", "FAILED", "PENDING", "CANCELED", "VOIDED"];

function resolveDisplayStatus(state: string | null | undefined, isVoid: boolean | null | undefined) {
  if (isVoid) return "VOIDED";
  return state ?? "UNKNOWN";
}

export default async function AuthorizationsListPage({
  searchParams,
}: {
  searchParams: Promise<{
    state?: string;
    range?: string;
    from?: string;
    to?: string;
    buyer?: string;
    last4?: string;
    voided?: string;
    id?: string;
  }>;
}) {
  const session = await getSession();
  const churchId = session!.churchId!;
  const { state, range, from, to, buyer, last4, voided, id } = await searchParams;
  const { from: startDate, to: endDate } = resolveDateRange(range, from, to);
  const dateFilter = startDate ? { gte: startDate, ...(endDate ? { lte: endDate } : {}) } : undefined;

  const isVoidedFilter = voided === "true" ? true : voided === "false" ? false : undefined;
  const isVoidedState = state === "VOIDED";
  const effectiveState = isVoidedState ? undefined : state;

  const authorizations = await prisma.finixAuthorization.findMany({
    where: {
      churchId,
      ...(effectiveState ? { state: effectiveState } : {}),
      ...(isVoidedState ? { isVoid: true } : {}),
      ...(isVoidedFilter != null && !isVoidedState ? { isVoid: isVoidedFilter } : {}),
      ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
    },
    orderBy: { createdAtFinix: "desc" },
    take: 200,
  });

  // Resolve instruments directly from finixPaymentInstrumentId (stored on auth now)
  // with a fallback to looking through finixTransferId for older records.
  const directInstrumentIds = authorizations
    .map((a) => a.finixPaymentInstrumentId)
    .filter((id): id is string => Boolean(id));

  const transferIds = authorizations
    .map((a) => a.finixTransferId)
    .filter((id): id is string => Boolean(id));

  const [directInstruments, transfers] = await Promise.all([
    directInstrumentIds.length
      ? prisma.finixPaymentInstrumentSnapshot.findMany({
          where: { finixPaymentInstrumentId: { in: directInstrumentIds } },
        })
      : [],
    transferIds.length
      ? prisma.finixTransfer.findMany({ where: { finixTransferId: { in: transferIds } } })
      : [],
  ]);

  const instrumentMap = new Map(directInstruments.map((i) => [i.finixPaymentInstrumentId, i]));

  // Fallback: for old records without finixPaymentInstrumentId, look up via transfer
  const fallbackInstrumentIds = transfers
    .map((t) => t.finixPaymentInstrumentId)
    .filter((id): id is string => Boolean(id) && !instrumentMap.has(id as string));
  if (fallbackInstrumentIds.length) {
    const fallbacks = await prisma.finixPaymentInstrumentSnapshot.findMany({
      where: { finixPaymentInstrumentId: { in: fallbackInstrumentIds } },
    });
    for (const i of fallbacks) instrumentMap.set(i.finixPaymentInstrumentId, i);
  }
  const transferMap = new Map(transfers.map((t) => [t.finixTransferId, t]));

  const donorIds = [...instrumentMap.values()]
    .map((i) => i.donorId)
    .filter((did): did is string => Boolean(did));
  const donors = donorIds.length
    ? await prisma.donor.findMany({ where: { id: { in: donorIds } } })
    : [];
  const donorMap = new Map(donors.map((d) => [d.id, d]));

  // Apply buyer name and last4 filters in memory (small result set, < 200 rows)
  const rows = authorizations.filter((a) => {
    const instrument =
      (a.finixPaymentInstrumentId ? instrumentMap.get(a.finixPaymentInstrumentId) : null) ??
      (a.finixTransferId
        ? instrumentMap.get(transferMap.get(a.finixTransferId)?.finixPaymentInstrumentId ?? "")
        : null);
    const donor = instrument?.donorId ? donorMap.get(instrument.donorId) : null;

    if (last4) {
      const l4 = instrument?.cardLast4 || instrument?.bankLast4;
      if (l4 !== last4) return false;
    }
    if (buyer) {
      const name = donor?.name || instrument?.accountHolderName || "";
      if (!name.toLowerCase().includes(buyer.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div>
      <h2 className="text-lg font-bold text-slate-900 mb-6">Authorizations</h2>

      <AuthorizationFilterBar
        states={STATES}
        exportHref="/api/merchant/transactions/authorizations/export"
        syncHref="/api/merchant/transactions/authorizations/sync"
      />

      <div className="flex items-start gap-6">
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-slate-100 shadow-sm overflow-visible">
          {rows.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-slate-500">
              No authorizations match these filters. Use the sync button above to import from Finix.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">Created</th>
                  <th className="px-6 py-3">Buyer</th>
                  <th className="px-6 py-3">Last 4</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const instrument =
                    (a.finixPaymentInstrumentId ? instrumentMap.get(a.finixPaymentInstrumentId) : null) ??
                    (a.finixTransferId
                      ? instrumentMap.get(transferMap.get(a.finixTransferId)?.finixPaymentInstrumentId ?? "")
                      : null);
                  const donor = instrument?.donorId ? donorMap.get(instrument.donorId) : null;
                  const displayStatus = resolveDisplayStatus(a.state, a.isVoid);
                  const isSelected = id === a.finixAuthorizationId;

                  return (
                    <ClickableTableRow
                      key={a.id}
                      id={a.finixAuthorizationId}
                      className={`border-t border-slate-50 hover:bg-slate-50 ${isSelected ? "bg-slate-50" : ""}`}
                    >
                      <td className="px-6 py-3">
                        <CopyableIdBadge id={a.finixAuthorizationId} />
                      </td>
                      <td className="px-6 py-3 text-slate-600 whitespace-nowrap">
                        {a.createdAtFinix
                          ? new Date(a.createdAtFinix).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-6 py-3 text-slate-700">
                        {formatPersonName(donor?.name, instrument?.accountHolderName)}
                      </td>
                      <td className="px-6 py-3 text-slate-500 font-mono text-xs">
                        {instrument?.cardLast4 || instrument?.bankLast4 || "—"}
                      </td>
                      <td className="px-6 py-3">
                        <StateBadge state={displayStatus} />
                        {a.failureCode && (
                          <p className="text-xs text-slate-400 mt-0.5">{a.failureCode}</p>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right font-semibold text-slate-900">
                        {formatCents(a.amountCents ?? 0)}
                      </td>
                    </ClickableTableRow>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {id && (
          <AuthorizationDetailPanel authorizationId={id} churchId={churchId} />
        )}
      </div>
    </div>
  );
}
