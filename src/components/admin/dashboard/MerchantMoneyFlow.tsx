import Link from "next/link";
import Card, { EmptyNote } from "@/components/merchant/reporting/overview/Card";
import { formatCents } from "@/components/merchant/reporting/overview/format";
import type { MerchantMoneyFlow as MoneyFlow } from "@/lib/admin/merchantMoneyFlow";

const th = "py-2 pr-4 text-right text-xs font-semibold text-slate-500 whitespace-nowrap";
const td = "py-2.5 pr-4 text-right tabular-nums whitespace-nowrap";

function Awaiting({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-slate-500">Cleared</span>;
  if (cents < 0) {
    return (
      <span
        className="font-semibold text-amber-700"
        title="Finix has paid out more than the charges WGC has on record, minus fees and refunds. Usually Finix settled a charge that WGC has no record of (for example one made directly in the Finix dashboard)."
      >
        {formatCents(cents)} · check
      </span>
    );
  }
  return <span className="text-slate-700">{formatCents(cents)}</span>;
}

/** Who bore the processing fee on each successful payment: the donor (opted to cover it) or the organization. */
function FeePayers({
  donor,
  org,
  noRecord,
  donorCoveredCents,
}: {
  donor: number;
  org: number;
  noRecord: number;
  donorCoveredCents: number;
}) {
  return (
    <span
      title={
        `${donor} donor${donor === 1 ? "" : "s"} covered the fee (${formatCents(donorCoveredCents)}), ${org} payment${org === 1 ? "" : "s"} had the fee ` +
        `paid by the organization` +
        (noRecord > 0 ? `, and ${noRecord} charge${noRecord === 1 ? " has" : "s have"} no WGC payment record so it isn't known.` : ".")
      }
    >
      <span className="font-semibold text-emerald-700">{donor.toLocaleString("en-US")}</span>
      <span className="text-xs text-slate-400"> donor · </span>
      <span className="font-semibold text-slate-700">{org.toLocaleString("en-US")}</span>
      <span className="text-xs text-slate-400"> org</span>
      {noRecord > 0 && <span className="text-xs text-slate-400"> · {noRecord.toLocaleString("en-US")} n/a</span>}
    </span>
  );
}

export default function MerchantMoneyFlow({ flow, periodLabel }: { flow: MoneyFlow; periodLabel: string }) {
  const { rows, totals } = flow;
  return (
    <Card
      title="Money flow by merchant"
      subtitle={`${periodLabel} · what each merchant collected, was charged in fees, and was paid out to its bank`}
    >
      {rows.length === 0 ? (
        <EmptyNote title="No merchant activity yet" body="Collected, fees and deposits will appear here once merchants process payments." />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="py-2 pr-4 text-left text-xs font-semibold text-slate-500">Merchant</th>
                  <th className={th}>Collected</th>
                  <th className={th}>Fees paid</th>
                  <th className={th} title="Finix charges a fixed fee (50¢) each time it pays out to a merchant's bank. Already included in Fees paid.">
                    of which payout fees
                  </th>
                  <th className={th}>Who covered the fee</th>
                  <th className={th}>Refunds &amp; returns</th>
                  <th className={th}>Deposited to bank</th>
                  <th className={th}>Awaiting deposit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.churchId} className="border-b border-slate-50">
                    <td className="py-2.5 pr-4">
                      <Link href={`/admin/merchants/${r.churchId}`} className="font-medium text-slate-800 hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className={td}>
                      <span className="font-semibold text-slate-900">{formatCents(r.collectedCents)}</span>
                      <span className="ml-1 text-xs text-slate-400">{r.paymentCount.toLocaleString("en-US")}×</span>
                    </td>
                    <td className={td} title={r.donorCoveredFeesCents > 0 ? `${formatCents(r.donorCoveredFeesCents)} of this was covered by donors` : undefined}>
                      {formatCents(r.feesCents)}
                    </td>
                    <td className={td}>
                      {formatCents(r.payoutFeeCents)}
                      <span className="ml-1 text-xs text-slate-400">{r.payoutFeeCount.toLocaleString("en-US")}×</span>
                    </td>
                    <td className={td}>
                      <FeePayers
                        donor={r.donorCoveredCount}
                        org={r.orgPaidCount}
                        noRecord={r.noFeeRecordCount}
                        donorCoveredCents={r.donorCoveredFeesCents}
                      />
                    </td>
                    <td className={td}>{formatCents(r.refundedCents)}</td>
                    <td
                      className={td}
                      title={r.pulledBackCents > 0 ? `${formatCents(r.pulledBackCents)} was also pulled back from the bank by Finix for fees` : undefined}
                    >
                      {formatCents(r.depositedCents)}
                      <span className="ml-1 text-xs text-slate-400">{r.depositCount.toLocaleString("en-US")}×</span>
                    </td>
                    <td className={td}>
                      <Awaiting cents={r.awaitingDepositCents} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold text-slate-900">
                  <td className="pt-3 pr-4">All merchants</td>
                  <td className={`${td} pt-3`}>{formatCents(totals.collectedCents)}</td>
                  <td className={`${td} pt-3`}>{formatCents(totals.feesCents)}</td>
                  <td className={`${td} pt-3`}>
                    {formatCents(totals.payoutFeeCents)}
                    <span className="ml-1 text-xs font-normal text-slate-400">{totals.payoutFeeCount.toLocaleString("en-US")}×</span>
                  </td>
                  <td className={`${td} pt-3`}>
                    <FeePayers
                      donor={totals.donorCoveredCount}
                      org={totals.orgPaidCount}
                      noRecord={totals.noFeeRecordCount}
                      donorCoveredCents={totals.donorCoveredFeesCents}
                    />
                  </td>
                  <td className={`${td} pt-3`}>{formatCents(totals.refundedCents)}</td>
                  <td className={`${td} pt-3`}>{formatCents(totals.depositedCents)}</td>
                  <td className={`${td} pt-3`}>
                    <Awaiting cents={totals.awaitingDepositCents} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Finix also charges a fixed 50¢ every time it pays out to a merchant&apos;s bank; that is part of Fees paid and shown separately in
            &ldquo;of which payout fees&rdquo;. Awaiting deposit = collected − fees − refunds &amp; returns − (deposited − fees Finix pulled back from the bank). Settlements arrive
            on a delay and Finix doesn&apos;t finalize fees until about the 15th of the next month, so a balance here is usually money still in
            flight, not a discrepancy.
          </p>
        </>
      )}
    </Card>
  );
}
