import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import CopyableIdBadge from "@/components/merchant/CopyableIdBadge";
import StateBadge from "@/components/merchant/StateBadge";
import { formatPersonName } from "@/lib/formatPersonName";
import { formatDateTime } from "@/lib/formatCentralTime";
import { titleCaseFromSnake as titleCase, instrumentStateLabel } from "@/lib/finix/displayFormatters";
import { Row } from "@/components/merchant/detail/DetailDrawerPrimitives";
import { TransactionTimeline, type TimelineEvent } from "@/components/merchant/detail/TransactionTimeline";
import { RelatedResources } from "@/components/merchant/detail/RelatedResources";
import EvidenceUpload from "./EvidenceUpload";

export default async function DisputeFullDetailPage({
  params,
}: {
  params: Promise<{ disputeId: string }>;
}) {
  const session = await getSession();
  const churchId = session!.churchId!;
  const { disputeId } = await params;

  const dispute = await prisma.finixDispute.findFirst({
    where: { finixDisputeId: disputeId, churchId },
    include: { evidence: { orderBy: { createdAt: "desc" } } },
  });

  if (!dispute) {
    return (
      <div>
        <Link href="/merchant/disputes" className="text-sm text-blue-600 hover:underline flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> All Disputes
        </Link>
        <p className="text-sm text-slate-500">This dispute could not be found.</p>
      </div>
    );
  }

  const transfer = dispute.finixTransferId
    ? await prisma.finixTransfer.findFirst({ where: { finixTransferId: dispute.finixTransferId, churchId } })
    : null;

  const instrument = transfer?.finixPaymentInstrumentId
    ? await prisma.finixPaymentInstrumentSnapshot.findUnique({
        where: { finixPaymentInstrumentId: transfer.finixPaymentInstrumentId },
      })
    : null;

  const donor = instrument?.donorId ? await prisma.donor.findUnique({ where: { id: instrument.donorId } }) : null;

  const settlement = transfer?.finixSettlementId
    ? await prisma.finixSettlement.findUnique({ where: { finixSettlementId: transfer.finixSettlementId } })
    : null;

  const flow: TimelineEvent[] = [
    { label: "Dispute Opened", sublabel: dispute.reason ? titleCase(dispute.reason) : undefined, date: dispute.createdAtFinix },
    ...(dispute.evidenceDueAt ? [{ label: "Evidence Due", date: dispute.evidenceDueAt } as TimelineEvent] : []),
    ...(dispute.respondedAt ? [{ label: "Evidence Submitted", date: dispute.respondedAt } as TimelineEvent] : []),
    ...(dispute.resolvedAt
      ? [{ label: "Dispute Resolved", sublabel: dispute.outcome ? titleCase(dispute.outcome) : undefined, date: dispute.resolvedAt } as TimelineEvent]
      : []),
  ].filter((e) => e.date);

  const now = new Date();
  const evidenceOpen = dispute.evidenceDueAt && !dispute.respondedAt && new Date(dispute.evidenceDueAt) > now;

  const relatedResources = [
    ...(dispute.finixTransferId
      ? [{ type: "Payment", label: dispute.finixTransferId, href: `/merchant/transactions/payments?id=${dispute.finixTransferId}` }]
      : []),
    ...(settlement
      ? [{ type: "Settlement", label: settlement.finixSettlementId, href: `/merchant/settlements?id=${settlement.finixSettlementId}` }]
      : []),
  ];

  return (
    <div>
      <Link href="/merchant/disputes" className="text-sm text-blue-600 hover:underline flex items-center gap-1 mb-4">
        <ArrowLeft className="w-4 h-4" /> All Disputes
      </Link>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
              <span>Dispute · {formatDateTime(dispute.createdAtFinix)}</span>
              <CopyableIdBadge id={dispute.finixDisputeId} />
            </div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{formatCents(dispute.amountCents ?? 0)}</span>
                <span className="text-sm font-semibold text-slate-400">{dispute.currency || "USD"}</span>
              </div>
              <StateBadge state={dispute.state} />
            </div>
            {evidenceOpen && (
              <div className="mt-1 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                <span className="text-xs font-semibold text-amber-800">
                  Evidence due {formatDateTime(dispute.evidenceDueAt)}
                </span>
              </div>
            )}
            <p className="text-sm text-slate-600 mt-3">
              Donor: <span className="font-semibold text-slate-900">{formatPersonName(donor?.name, instrument?.accountHolderName)}</span>
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Transaction Flow</h3>
            <TransactionTimeline events={flow} />
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Dispute Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <Row label="Reason" value={titleCase(dispute.reason)} />
              <Row label="State" value={titleCase(dispute.state)} />
              {dispute.outcome && <Row label="Outcome" value={titleCase(dispute.outcome)} />}
              <Row label="Evidence Due" value={formatDateTime(dispute.evidenceDueAt)} />
              <Row label="Responded" value={formatDateTime(dispute.respondedAt)} />
              <Row label="Resolved" value={formatDateTime(dispute.resolvedAt)} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Evidence</h3>
            <EvidenceUpload
              disputeId={dispute.finixDisputeId}
              locked={Boolean(dispute.respondedAt)}
              evidence={dispute.evidence.map((e) => ({
                id: e.id,
                fileName: e.fileName,
                mimeType: e.mimeType,
                uploadedByEmail: e.uploadedByEmail,
                submittedAt: e.submittedAt,
                createdAt: e.createdAt,
              }))}
            />
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Donor</h3>
            <Row label="Name" value={formatPersonName(donor?.name, instrument?.accountHolderName)} />
            <Row label="Email" value={donor?.email || "—"} />
            <Row label="Phone" value={donor?.phone || "—"} />
          </div>

          {transfer && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Original Payment</h3>
              <Row label="Amount" value={formatCents(transfer.amountCents ?? 0)} />
              <Row label="State" value={titleCase(transfer.state)} />
              <Row label="Created" value={formatDateTime(transfer.createdAtFinix)} />
            </div>
          )}

          {instrument && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Payment Instrument</h3>
              <Row label="State" value={instrumentStateLabel(instrument.state)} />
              <Row label="Type" value={instrument.cardBrand || (instrument.bankLast4 ? "Bank Account" : instrument.instrumentType || "—")} />
              <Row
                label="Masked Number"
                value={instrument.cardLast4 || instrument.bankLast4 ? `••••${instrument.cardLast4 || instrument.bankLast4}` : "—"}
              />
              <Row label="Account Holder Name" value={instrument.accountHolderName || "—"} />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Related Resources</h3>
            <RelatedResources resources={relatedResources} />
          </div>
        </div>
      </div>
    </div>
  );
}
