import { prisma } from "@/lib/prisma";

/**
 * Shared data loader for a single settlement's full detail view — used by
 * both the right-side drawer and the full detail page, mirroring
 * loadDisputeDetail's pattern so the two never drift and every related
 * table is fetched with one batch query (by transferId list) instead of
 * per-row, no matter how many payments a settlement includes.
 */
export async function loadSettlementDetail(finixSettlementId: string, churchId: string) {
  const settlement = await prisma.finixSettlement.findFirst({
    where: { finixSettlementId, churchId },
  });
  if (!settlement) return null;

  const church = await prisma.church.findUnique({ where: { id: churchId } });

  const transfers = await prisma.finixTransfer.findMany({
    where: { finixSettlementId, churchId },
    orderBy: { createdAtFinix: "desc" },
  });
  const transferIds = transfers.map((t) => t.finixTransferId);

  const [payments, refunds, bankReturns, disputes, fees, deposit] = await Promise.all([
    transferIds.length
      ? prisma.payment.findMany({ where: { finixTransferId: { in: transferIds }, churchId } })
      : Promise.resolve([]),
    prisma.finixRefundOrReversal.findMany({ where: { finixSettlementId, churchId }, orderBy: { createdAtFinix: "desc" } }),
    transferIds.length
      ? prisma.bankReturn.findMany({ where: { originalTransferId: { in: transferIds }, churchId }, orderBy: { createdAtFinix: "desc" } })
      : Promise.resolve([]),
    transferIds.length
      ? prisma.finixDispute.findMany({ where: { finixTransferId: { in: transferIds }, churchId }, orderBy: { createdAtFinix: "desc" } })
      : Promise.resolve([]),
    transferIds.length
      ? prisma.finixFee.findMany({ where: { linkedToId: { in: transferIds }, churchId }, orderBy: { createdAtFinix: "desc" } })
      : Promise.resolve([]),
    // Confirmed real link: Finix's FUNDING_TRANSFER_ATTEMPT webhook payload
    // reports its own `settlement` field directly — this is not a WGC-side
    // inference, so no confidence/matching-reason system is needed here.
    prisma.finixFundingTransferAttempt.findFirst({
      where: { finixSettlementId, churchId },
      orderBy: { createdAtFinix: "desc" },
    }),
  ]);

  const donorIds = [...new Set(payments.map((p) => p.donorId).filter((id): id is string => !!id))];
  const donors = donorIds.length ? await prisma.donor.findMany({ where: { id: { in: donorIds } } }) : [];
  const donorsById = new Map(donors.map((d) => [d.id, d]));

  const instrumentIds = [...new Set(payments.map((p) => p.finixPaymentInstrumentId).filter((id): id is string => !!id))];
  const instruments = instrumentIds.length
    ? await prisma.finixPaymentInstrumentSnapshot.findMany({ where: { finixPaymentInstrumentId: { in: instrumentIds } } })
    : [];
  const instrumentsById = new Map(instruments.map((i) => [i.finixPaymentInstrumentId, i]));

  const paymentRows = payments.map((payment) => ({
    payment,
    donor: payment.donorId ? donorsById.get(payment.donorId) ?? null : null,
    instrument: payment.finixPaymentInstrumentId ? instrumentsById.get(payment.finixPaymentInstrumentId) ?? null : null,
    transfer: transfers.find((t) => t.finixTransferId === payment.finixTransferId) ?? null,
  }));

  return { settlement, church, transfers, paymentRows, refunds, bankReturns, disputes, fees, deposit };
}

export type SettlementDetail = NonNullable<Awaited<ReturnType<typeof loadSettlementDetail>>>;
