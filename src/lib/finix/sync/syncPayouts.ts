// TODO: FinixClient does not yet have listFundingTransferAttempts()/getPayoutProfile().
// Confirm whether Finix exposes funding_transfer_attempt as its own resource
// or only as a sub-field of settlement before wiring this up.

import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";

export async function syncPayoutsForSettlement(_finixSettlementId: string, _churchId?: string) {
  throw new Error(
    "syncPayoutsForSettlement is not implemented — FinixClient has no funding transfer " +
      "attempt methods yet. See TODO in src/lib/finix/sync/syncPayouts.ts."
  );
}

/** Placeholder upsert shape, kept here so the FinixFundingTransferAttempt model has a documented writer. */
async function _upsertFundingTransferAttempt(attempt: any, churchId?: string) {
  await prisma.finixFundingTransferAttempt.upsert({
    where: { finixFundingTransferAttemptId: attempt.id },
    create: {
      finixFundingTransferAttemptId: attempt.id,
      churchId: churchId ?? null,
      finixSettlementId: attempt.settlement ?? null,
      finixMerchantId: attempt.merchant ?? null,
      state: attempt.state ?? null,
      amountCents: attempt.amount ?? null,
      currency: attempt.currency ?? null,
      bankAccountLast4: attempt.bank_account_last4 ?? null,
      bankAccountType: attempt.bank_account_type ?? null,
      failureCode: attempt.failure_code ?? null,
      failureMessage: attempt.failure_message ?? null,
      rawJsonRedacted: redactFinixPayload(attempt),
      createdAtFinix: attempt.created_at ? new Date(attempt.created_at) : null,
      updatedAtFinix: attempt.updated_at ? new Date(attempt.updated_at) : null,
    },
    update: {
      state: attempt.state ?? null,
      failureCode: attempt.failure_code ?? null,
      failureMessage: attempt.failure_message ?? null,
      rawJsonRedacted: redactFinixPayload(attempt),
      updatedAtFinix: attempt.updated_at ? new Date(attempt.updated_at) : null,
    },
  });
}
