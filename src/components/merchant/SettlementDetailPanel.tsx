import { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import CopyableIdBadge from "@/components/merchant/CopyableIdBadge";
import StateBadge from "@/components/merchant/StateBadge";
import ClosePanelButton from "@/components/merchant/ClosePanelButton";
import { PanelNavArrows, ViewAllDetailsButton, PaymentMoreMenu, PinButton } from "@/components/merchant/PaymentDetailActions";

function formatDateTime(date: Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SettlementDetailPanel({
  settlementId,
  churchId,
}: {
  settlementId: string;
  churchId: string;
}) {
  const settlement = await prisma.finixSettlement.findFirst({
    where: { finixSettlementId: settlementId, churchId },
  });

  if (!settlement) {
    return (
      <div className="w-full lg:w-[420px] shrink-0 border-l border-slate-100 bg-white rounded-2xl lg:rounded-none p-6">
        <p className="text-sm text-slate-500">This settlement could not be found.</p>
      </div>
    );
  }

  const [transfers, refunds, deposits] = await Promise.all([
    prisma.finixTransfer.findMany({
      where: { finixSettlementId: settlementId },
      orderBy: { createdAtFinix: "asc" },
      take: 50,
    }),
    prisma.finixRefundOrReversal.findMany({
      where: { finixSettlementId: settlementId },
      orderBy: { createdAtFinix: "asc" },
      take: 50,
    }),
    prisma.finixFundingTransferAttempt.findMany({
      where: { finixSettlementId: settlementId },
      orderBy: { createdAtFinix: "asc" },
    }),
  ]);

  return (
    <div className="w-full lg:w-[420px] shrink-0 bg-white border border-slate-100 rounded-2xl shadow-sm h-fit lg:sticky lg:top-6">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <PanelNavArrows />
        <ViewAllDetailsButton />
        <ClosePanelButton />
      </div>

      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span>Settlement · {formatDateTime(settlement.createdAtFinix)}</span>
          <div className="flex items-center gap-1.5">
            <CopyableIdBadge id={settlement.finixSettlementId} />
            <PinButton />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">
              {formatCents(settlement.totalAmountCents ?? 0)}
            </span>
            <span className="text-sm font-semibold text-slate-400">{settlement.currency || "USD"}</span>
          </div>
          <StateBadge state={settlement.state} />
        </div>
        <PaymentMoreMenu />
      </div>

      <Section title="Settlement Details">
        <Row label="Total Amount" value={formatCents(settlement.totalAmountCents ?? 0)} />
        <Row label="Net Amount" value={formatCents(settlement.netAmountCents ?? 0)} />
        <Row label="Fees" value={formatCents(settlement.feeAmountCents ?? 0)} />
        <Row label="Refunds" value={formatCents(settlement.refundAmountCents ?? 0)} />
        <Row label="Disputes" value={formatCents(settlement.disputeAmountCents ?? 0)} />
        <Row label="Accrued" value={formatDateTime(settlement.accruedAt)} />
        <Row label="Settled" value={formatDateTime(settlement.settledAt)} />
      </Section>

      <Section title={`Payments (${transfers.length})`}>
        {transfers.length === 0 ? (
          <p className="text-sm text-slate-500">No payments linked yet.</p>
        ) : (
          <div className="space-y-2">
            {transfers.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <CopyableIdBadge id={t.finixTransferId} label={t.finixTransferId} variant="link" />
                <span className="font-semibold text-slate-700">{formatCents(t.amountCents ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Refunds (${refunds.length})`}>
        {refunds.length === 0 ? (
          <p className="text-sm text-slate-500">No refunds linked yet.</p>
        ) : (
          <div className="space-y-2">
            {refunds.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <CopyableIdBadge id={r.finixReversalId} label={r.finixReversalId} variant="link" />
                <span className="font-semibold text-slate-700">{formatCents(r.amountCents ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Deposits" last>
        {deposits.length === 0 ? (
          <p className="text-sm text-slate-500">No bank deposit has been sent for this settlement yet.</p>
        ) : (
          <div className="space-y-2">
            {deposits.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-semibold text-slate-700">
                    {d.bankAccountLast4 ? `•••• ${d.bankAccountLast4}` : "Bank Deposit"}
                  </p>
                  <p className="text-xs text-slate-400">{formatDateTime(d.sentAt ?? d.createdAtFinix)}</p>
                </div>
                <div className="text-right">
                  <StateBadge state={d.state} />
                  <p className="font-semibold text-slate-900 mt-0.5">{formatCents(d.amountCents ?? 0)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, last, children }: { title: string; last?: boolean; children: ReactNode }) {
  return (
    <div className={`px-5 py-4 ${last ? "" : "border-b border-slate-100"}`}>
      <h3 className="text-sm font-bold text-slate-900 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-slate-700 text-right">{value}</span>
    </div>
  );
}
