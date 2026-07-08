// TODO: FinixClient does not yet have listFees()/getFeeProfile() methods, and
// the exact Finix fee list endpoint (per-transfer vs per-merchant vs
// fee_profile) is unconfirmed. This is a stub — wire it up once the Finix
// fee API shape is confirmed. Do not call this from webhook/sync routes yet.

import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

export async function syncFeesForTransfer(_finixTransferId: string, _churchId?: string) {
  throw new Error(
    "syncFeesForTransfer is not implemented — FinixClient.listFees() is unconfirmed. " +
      "See TODO in src/lib/finix/sync/syncFees.ts."
  );
}

/** Placeholder upsert shape, kept here so the FinixFee model has a documented writer. */
async function _upsertFeeRecord(fee: any, churchId?: string) {
  await prisma.finixFee.upsert({
    where: { finixFeeId: fee.id },
    create: {
      finixFeeId: fee.id,
      churchId: churchId ?? null,
      linkedToId: fee.linked_to ?? null,
      linkedToType: fee.linked_to_type ?? null,
      feeType: fee.type ?? null,
      amountCents: fee.amount ?? null,
      currency: fee.currency ?? null,
      state: fee.state ?? null,
      rawJsonRedacted: redactFinixPayload(fee),
      createdAtFinix: fee.created_at ? new Date(fee.created_at) : null,
      updatedAtFinix: fee.updated_at ? new Date(fee.updated_at) : null,
    },
    update: {
      state: fee.state ?? null,
      rawJsonRedacted: redactFinixPayload(fee),
      updatedAtFinix: fee.updated_at ? new Date(fee.updated_at) : null,
    },
  });
}
