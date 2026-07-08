import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

/**
 * Syncs a single payment instrument's safe/masked metadata into
 * FinixPaymentInstrumentSnapshot. Never stores full card/bank numbers —
 * only last4, brand, and expiration, matching Finix's own masked response.
 */
export async function syncPaymentInstrument(
  finixPaymentInstrumentId: string,
  opts?: { churchId?: string; donorId?: string }
) {
  const instrument = await finixClient.getPaymentInstrument(finixPaymentInstrumentId);

  await prisma.finixPaymentInstrumentSnapshot.upsert({
    where: { finixPaymentInstrumentId },
    create: {
      finixPaymentInstrumentId,
      churchId: opts?.churchId ?? null,
      donorId: opts?.donorId ?? null,
      finixIdentityId: instrument.identity ?? null,
      instrumentType: instrument.instrument_type ?? null,
      paymentMethodType: instrument.type ?? null,
      cardBrand: instrument.brand ?? null,
      cardLast4: instrument.last_four ?? null,
      cardExpirationMonth: instrument.expiration_month ?? null,
      cardExpirationYear: instrument.expiration_year ?? null,
      bankLast4: instrument.masked_account_number ?? null,
      bankAccountType: instrument.account_type ?? null,
      accountHolderName: instrument.name ?? null,
      state: instrument.state ?? null,
      enabled: Boolean(instrument.enabled),
      rawJsonRedacted: redactFinixPayload(instrument),
      createdAtFinix: instrument.created_at ? new Date(instrument.created_at) : null,
      updatedAtFinix: instrument.updated_at ? new Date(instrument.updated_at) : null,
      lastSyncedAt: new Date(),
    },
    update: {
      state: instrument.state ?? null,
      enabled: Boolean(instrument.enabled),
      rawJsonRedacted: redactFinixPayload(instrument),
      updatedAtFinix: instrument.updated_at ? new Date(instrument.updated_at) : null,
      lastSyncedAt: new Date(),
    },
  });
}
