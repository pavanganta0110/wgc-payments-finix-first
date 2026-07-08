import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

/**
 * Syncs settlement/payout batches for a merchant into FinixSettlement.
 * TODO: confirm exact field names for total/net/fee/refund/dispute amounts
 * once real settlement payloads are available (Finix's settlement schema
 * varies by whether gross or net settlement is enabled on the merchant).
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

    if (existing) updated++;
    else created++;
  }

  return { processed: settlements.length, created, updated };
}
