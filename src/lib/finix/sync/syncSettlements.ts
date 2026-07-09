import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

/**
 * Links every transfer (payment or refund/reversal) accrued into a
 * settlement batch back to that settlement, via GET /settlements/{id}/transfers.
 * Payments and refunds/reversals are both represented as Transfers on
 * Finix's side, but WGC splits them into FinixTransfer and
 * FinixRefundOrReversal, so both tables need the update.
 */
export async function linkTransfersToSettlement(finixSettlementId: string) {
  const response = await finixClient.listSettlementTransfers(finixSettlementId);
  const transfers: any[] = response?._embedded?.transfers ?? [];
  const transferIds = transfers.map((t) => t.id).filter(Boolean);

  if (transferIds.length === 0) return { linked: 0 };

  const [transfersUpdated, refundsUpdated] = await Promise.all([
    prisma.finixTransfer.updateMany({
      where: { finixTransferId: { in: transferIds } },
      data: { finixSettlementId },
    }),
    prisma.finixRefundOrReversal.updateMany({
      where: { finixReversalId: { in: transferIds } },
      data: { finixSettlementId },
    }),
  ]);

  return { linked: transfersUpdated.count + refundsUpdated.count };
}

/**
 * Syncs settlement/payout batches for a merchant into FinixSettlement, then
 * links every transfer/refund accrued into each settlement so payment
 * detail views can show "Settlement: {id}" and accurate transaction-flow
 * events.
 */
export async function syncSettlements(finixMerchantId: string, churchId?: string) {
  const response = await finixClient.listSettlements(finixMerchantId);
  const settlements: any[] = response?._embedded?.settlements ?? [];

  let created = 0;
  let updated = 0;

  for (const settlement of settlements) {
    const existing = await prisma.finixSettlement.findUnique({
      where: { finixSettlementId: settlement.id },
    });

    await prisma.finixSettlement.upsert({
      where: { finixSettlementId: settlement.id },
      create: {
        finixSettlementId: settlement.id,
        churchId: churchId ?? null,
        finixMerchantId,
        state: settlement.state ?? null,
        totalAmountCents: settlement.total_amount ?? null,
        currency: settlement.currency ?? null,
        rawJsonRedacted: redactFinixPayload(settlement),
        createdAtFinix: settlement.created_at ? new Date(settlement.created_at) : null,
        updatedAtFinix: settlement.updated_at ? new Date(settlement.updated_at) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        state: settlement.state ?? null,
        totalAmountCents: settlement.total_amount ?? null,
        rawJsonRedacted: redactFinixPayload(settlement),
        updatedAtFinix: settlement.updated_at ? new Date(settlement.updated_at) : null,
        lastSyncedAt: new Date(),
      },
    });

    try {
      await linkTransfersToSettlement(settlement.id);
    } catch (err) {
      console.error(`Failed to link transfers for settlement ${settlement.id}:`, err);
    }

    if (existing) updated++;
    else created++;
  }

  return { processed: settlements.length, created, updated };
}
