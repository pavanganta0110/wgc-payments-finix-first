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

  const [transfers, refunds, disputes] = await Promise.all([
    prisma.finixTransfer.findMany({ where: transferWhere }),
    prisma.finixRefundOrReversal.findMany({
      where: {
        createdAtFinix: { gte: periodStart, lte: periodEnd },
        ...(churchId ? { churchId } : {}),
      },
    }),
    prisma.finixDispute.findMany({
      where: {
        createdAtFinix: { gte: periodStart, lte: periodEnd },
        ...(churchId ? { churchId } : {}),
      },
    }),
  ]);

  const succeeded = transfers.filter((t) => (t.state || "").toUpperCase() === "SUCCEEDED");
  const failed = transfers.filter((t) => (t.state || "").toUpperCase() === "FAILED");

  const grossVolumeCents = succeeded.reduce((sum, t) => sum + (t.amountCents ?? 0), 0);
  const feeAmountCents = succeeded.reduce((sum, t) => sum + (t.feeCents ?? 0), 0);
  const refundAmountCents = refunds.reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
  const disputeAmountCents = disputes.reduce((sum, d) => sum + (d.amountCents ?? 0), 0);
  const netVolumeCents = grossVolumeCents - feeAmountCents - refundAmountCents;

  const donorCount = churchId
    ? await prisma.donor.count({
        where: { churchId, createdAt: { gte: periodStart, lte: periodEnd } },
      })
    : undefined;

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
      donorCount: donorCount ?? null,
      transactionCount: transfers.length,
      failedTransactionCount: failed.length,
      payloadJson: {
        succeededCount: succeeded.length,
        failedCount: failed.length,
        refundCount: refunds.length,
        disputeCount: disputes.length,
      },
    },
  });

  return snapshot;
}
