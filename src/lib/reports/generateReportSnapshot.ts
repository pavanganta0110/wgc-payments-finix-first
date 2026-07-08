import { prisma } from "@/lib/prisma";

export type ReportType = "church_monthly" | "wgc_platform";

/**
 * Builds and stores a ReportSnapshot from WGC's own database (FinixTransfer,
 * FinixRefundOrReversal, FinixFee, FinixSettlement, Donor) — never queries
 * Finix's Dashboard/API directly, per the "custom reporting" requirement.
 * churchId is required for "church_monthly", omitted for "wgc_platform".
 */
export async function generateReportSnapshot(params: {
  reportType: ReportType;
  periodStart: Date;
  periodEnd: Date;
  churchId?: string;
}) {
  const { reportType, periodStart, periodEnd, churchId } = params;

  const transferWhere = {
    createdAtFinix: { gte: periodStart, lte: periodEnd },
    ...(churchId ? { churchId } : {}),
  };

  const periodWhere = {
    createdAtFinix: { gte: periodStart, lte: periodEnd },
    ...(churchId ? { churchId } : {}),
  };

  const [transfers, refunds, disputes, fees, payouts] = await Promise.all([
    prisma.finixTransfer.findMany({ where: transferWhere }),
    prisma.finixRefundOrReversal.findMany({ where: periodWhere }),
    prisma.finixDispute.findMany({ where: periodWhere }),
    prisma.finixFee.findMany({
      where: {
        createdAtFinix: { gte: periodStart, lte: periodEnd },
        ...(churchId ? { churchId } : {}),
      },
    }),
    prisma.finixFundingTransferAttempt.findMany({ where: periodWhere }),
  ]);

  const succeeded = transfers.filter((t) => (t.state || "").toUpperCase() === "SUCCEEDED");
  const failed = transfers.filter((t) => (t.state || "").toUpperCase() === "FAILED");

  const grossVolumeCents = succeeded.reduce((sum, t) => sum + (t.amountCents ?? 0), 0);
  // Prefer dedicated FinixFee records (per-fee, confirmed API) over the
  // transfer's own feeCents summary field when available.
  const feeAmountCents =
    fees.length > 0
      ? fees.reduce((sum, f) => sum + (f.amountCents ?? 0), 0)
      : succeeded.reduce((sum, t) => sum + (t.feeCents ?? 0), 0);
  const applicationFeeCents = succeeded.reduce((sum, t) => sum + (t.applicationFeeCents ?? 0), 0);
  const refundAmountCents = refunds.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
  const disputeAmountCents = disputes.reduce((sum, d) => sum + (d.amountCents ?? 0), 0);
  const payoutAmountCents = payouts.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
  const netVolumeCents = grossVolumeCents - feeAmountCents - refundAmountCents;

  const donorCount = churchId
    ? await prisma.donor.count({
        where: { churchId, createdAt: { gte: periodStart, lte: periodEnd } },
      })
    : undefined;

  // Per the reporting rule: mark each area synced / partially synced /
  // pending Finix API confirmation, so report consumers never mistake a
  // zero-value section for "nothing happened" when it's actually unwired.
  const syncStatus = {
    transfers: "synced",
    refunds: "synced",
    disputes: "synced",
    fees: fees.length > 0 ? "synced" : "synced_but_empty_or_no_transfers",
    payouts: "partially_synced", // finixSettlementId linkage unconfirmed, see syncPayouts.ts TODO
    subscriptions: "pending_finix_api_confirmation",
  };

  const snapshot = await prisma.reportSnapshot.create({
    data: {
      churchId: churchId ?? null,
      reportType,
      periodStart,
      periodEnd,
      grossVolumeCents,
      netVolumeCents,
      refundAmountCents,
      feeAmountCents,
      disputeAmountCents,
      payoutAmountCents,
      donorCount: donorCount ?? null,
      transactionCount: transfers.length,
      failedTransactionCount: failed.length,
      payloadJson: {
        succeededCount: succeeded.length,
        failedCount: failed.length,
        refundCount: refunds.length,
        disputeCount: disputes.length,
        feeCount: fees.length,
        payoutCount: payouts.length,
        applicationFeeCents,
        syncStatus,
      },
    },
  });

  return snapshot;
}
