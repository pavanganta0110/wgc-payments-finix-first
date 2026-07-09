import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

/**
 * Syncs Authorizations for a merchant into FinixAuthorization. Field shape
 * matches the confirmed Authorization resource seen in Finix's idempotency
 * and fraud-detection docs (id, state, amount, amount_requested, currency,
 * source, failure_code, failure_message, is_void, void_state, expires_at).
 */
export async function syncAuthorizations(finixMerchantId: string, churchId?: string) {
  const response = await finixClient.listAuthorizationsForMerchant(finixMerchantId);
  const authorizations: any[] = response?._embedded?.authorizations ?? [];

  let created = 0;
  let updated = 0;

  for (const auth of authorizations) {
    const existing = await prisma.finixAuthorization.findUnique({
      where: { finixAuthorizationId: auth.id },
    });

    await prisma.finixAuthorization.upsert({
      where: { finixAuthorizationId: auth.id },
      create: {
        finixAuthorizationId: auth.id,
        churchId: churchId ?? null,
        finixMerchantId,
        finixTransferId: auth.transfer ?? null,
        state: auth.state ?? null,
        amountCents: auth.amount ?? null,
        amountRequestedCents: auth.amount_requested ?? null,
        currency: auth.currency ?? null,
        failureCode: auth.failure_code ?? null,
        failureMessage: auth.failure_message ?? null,
        isVoid: Boolean(auth.is_void),
        voidState: auth.void_state ?? null,
        expiresAt: auth.expires_at ? new Date(auth.expires_at) : null,
        rawJsonRedacted: redactFinixPayload(auth),
        createdAtFinix: auth.created_at ? new Date(auth.created_at) : null,
        updatedAtFinix: auth.updated_at ? new Date(auth.updated_at) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        state: auth.state ?? null,
        finixTransferId: auth.transfer ?? null,
        failureCode: auth.failure_code ?? null,
        failureMessage: auth.failure_message ?? null,
        isVoid: Boolean(auth.is_void),
        voidState: auth.void_state ?? null,
        rawJsonRedacted: redactFinixPayload(auth),
        updatedAtFinix: auth.updated_at ? new Date(auth.updated_at) : null,
        lastSyncedAt: new Date(),
      },
    });

    if (existing) updated++;
    else created++;
  }

  return { processed: authorizations.length, created, updated };
}
