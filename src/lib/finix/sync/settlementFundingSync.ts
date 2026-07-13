import { finixClient } from "@/lib/finix/client";
import { prisma } from "@/lib/prisma";
import { redactFinixPayload } from "@/lib/finix/redact";
import { toSettlementFieldsForCreate, toSettlementFieldsForUpdate, linkTransfersToSettlement, recomputeSettlementAggregates } from "@/lib/finix/sync/syncSettlements";

/**
 * Live settlement + merchant-deposit refresh, following the same
 * "webhook is the primary mechanism, this is the self-healing fallback"
 * pattern as reconcilePendingPayoutAccountsForChurch — called whenever a
 * merchant opens a settlement's detail view (see settlementDetail.ts) or
 * the settlements list (see settlementsList.ts), so a missing/stale/
 * mis-scoped webhook row is never the only chance to get this right.
 */

// Shared throttle — a settlement triggers a real Finix API round trip
// (settlement + funding transfers) at most this often across every caller
// (detail view, list view), so rapid re-renders/navigation/pagination
// don't hammer Finix, while staying well within the range where a
// merchant sees corrected data shortly after a missed/delayed webhook
// instead of a permanently stale UNKNOWN/unlinked row.
export const LIVE_REFRESH_THROTTLE_MS = 30_000;

export function isStaleEnoughToRefresh(lastSyncedAt: Date | null | undefined): boolean {
  return !lastSyncedAt || Date.now() - lastSyncedAt.getTime() > LIVE_REFRESH_THROTTLE_MS;
}

/**
 * Identifies the merchant's own bank-deposit funding transfer among
 * whatever Finix's settlement funding-transfer response returns — Finix
 * may include both a merchant-facing deposit and the platform's own
 * transfer in related resources, and the merchant dashboard must never
 * show the platform's. Matches defensively against every field name this
 * codebase's existing Finix response handling has confirmed or assumed
 * elsewhere (see the webhook handler's FUNDING_TRANSFER_ATTEMPT block):
 * `merchant`, `merchant_id`, and a `tags`/`type` marker if present. Falls
 * back to the first entry only when there is exactly one and no merchant
 * id to disambiguate against — never guesses between multiple candidates.
 */
export function selectMerchantFundingTransfer(fundingTransfers: any[], finixMerchantId: string | null): any | null {
  if (!Array.isArray(fundingTransfers) || fundingTransfers.length === 0) return null;

  const isPlatformDeposit = (t: any) => {
    const type = String(t?.type || t?.subtype || t?.deposit_type || "").toUpperCase();
    return type.includes("PLATFORM");
  };

  const merchantCandidates = fundingTransfers.filter((t) => !isPlatformDeposit(t));
  if (merchantCandidates.length === 0) return null;

  if (finixMerchantId) {
    const exact = merchantCandidates.find((t) => (t?.merchant ?? t?.merchant_id ?? t?.linked_to) === finixMerchantId);
    if (exact) return exact;
  }

  // No merchant id to disambiguate, or none matched exactly — only safe to
  // guess when there's just one non-platform candidate.
  return merchantCandidates.length === 1 ? merchantCandidates[0] : null;
}

/** Maps one raw Finix funding-transfer object to this app's DB field shape — defensive about field names since the exact response shape is unconfirmed (see client.ts's getSettlementFundingTransfers comment). */
export function mapFundingTransferFields(transfer: any) {
  return {
    state: transfer.state ?? transfer.status ?? null,
    amountCents: transfer.amount ?? null,
    netAmountCents: transfer.net_amount ?? transfer.amount ?? null,
    currency: transfer.currency ?? null,
    fundingSpeed: transfer.funding_speed ?? transfer.ready_to_settle_upon ?? null,
    bankAccountLast4: transfer.masked_account_number ?? null,
    bankAccountType: transfer.account_type ?? null,
    bankName: transfer.bank_name ?? transfer.bank ?? null,
    accountHolderName: transfer.name ?? transfer.account_holder_name ?? null,
    destinationPaymentInstrumentId: transfer.destination ?? transfer.destination_instrument ?? null,
    failureCode: transfer.failure_code ?? null,
    failureMessage: transfer.failure_message ?? null,
    traceId: transfer.trace_id ?? null,
    estimatedArrivalDate: transfer.estimated_arrival_date ? new Date(transfer.estimated_arrival_date) : null,
    sentAt: transfer.sent_at ? new Date(transfer.sent_at) : null,
    arrivedAt: transfer.arrived_at ? new Date(transfer.arrived_at) : null,
    createdAtFinix: transfer.created_at ? new Date(transfer.created_at) : null,
    updatedAtFinix: transfer.updated_at ? new Date(transfer.updated_at) : null,
  };
}

/**
 * True when the incoming Finix timestamp is not older than what's already
 * stored — an out-of-order webhook/refresh must never overwrite a newer
 * state with an older one. When either side is missing a timestamp, this
 * defaults to allowing the update (matches this codebase's existing
 * "trust the latest sync" behavior when timestamps aren't available).
 */
export function isFreshEnoughToApply(existingUpdatedAtFinix: Date | null | undefined, incomingUpdatedAtFinix: Date | null | undefined): boolean {
  if (!existingUpdatedAtFinix || !incomingUpdatedAtFinix) return true;
  return incomingUpdatedAtFinix.getTime() >= existingUpdatedAtFinix.getTime();
}

export interface SettlementFundingRefreshResult {
  refreshed: boolean;
  hasFundingTransferData: boolean;
  error?: string;
}

/**
 * Re-pulls a settlement and its merchant funding transfer directly from
 * Finix and upserts both into the DB — the live-refresh half of "read
 * local first, then confirm against Finix" (see loadSettlementDetail).
 * Never throws; a Finix-side failure just means the caller falls back to
 * whatever's already in the DB.
 */
export async function refreshSettlementAndDepositFromFinix(
  finixSettlementId: string,
  churchId: string,
  finixMerchantId: string | null,
): Promise<SettlementFundingRefreshResult> {
  try {
    const settlement = await finixClient.getSettlement(finixSettlementId);

    await prisma.finixSettlement.upsert({
      where: { finixSettlementId },
      create: {
        finixSettlementId,
        churchId,
        finixMerchantId: finixMerchantId ?? settlement?.merchant_id ?? null,
        ...toSettlementFieldsForCreate(settlement),
        rawJsonRedacted: redactFinixPayload(settlement),
        createdAtFinix: settlement.created_at ? new Date(settlement.created_at) : null,
        updatedAtFinix: settlement.updated_at ? new Date(settlement.updated_at) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        ...toSettlementFieldsForUpdate(settlement),
        rawJsonRedacted: redactFinixPayload(settlement),
        updatedAtFinix: settlement.updated_at ? new Date(settlement.updated_at) : undefined,
        lastSyncedAt: new Date(),
      },
    });

    try {
      await linkTransfersToSettlement(finixSettlementId);
      await recomputeSettlementAggregates(finixSettlementId);
    } catch (err) {
      console.error("Failed to link transfers during settlement live refresh:", err);
    }

    let hasFundingTransferData = false;
    try {
      const response = await finixClient.getSettlementFundingTransfers(finixSettlementId);
      const fundingTransfers: any[] = response?._embedded?.funding_transfers ?? response?.funding_transfers ?? (Array.isArray(response) ? response : []);
      hasFundingTransferData = true;

      const merchantTransfer = selectMerchantFundingTransfer(fundingTransfers, finixMerchantId);
      if (merchantTransfer?.id) {
        const existing = await prisma.finixFundingTransferAttempt.findUnique({
          where: { finixFundingTransferAttemptId: merchantTransfer.id },
        });
        const mapped = mapFundingTransferFields(merchantTransfer);

        if (isFreshEnoughToApply(existing?.updatedAtFinix, mapped.updatedAtFinix)) {
          await prisma.finixFundingTransferAttempt.upsert({
            where: { finixFundingTransferAttemptId: merchantTransfer.id },
            create: {
              finixFundingTransferAttemptId: merchantTransfer.id,
              churchId,
              finixMerchantId,
              finixSettlementId,
              ...mapped,
              rawJsonRedacted: redactFinixPayload(merchantTransfer),
              lastSyncedAt: new Date(),
            },
            update: {
              churchId: churchId ?? undefined,
              finixSettlementId: finixSettlementId ?? undefined,
              state: mapped.state ?? undefined,
              amountCents: mapped.amountCents ?? undefined,
              netAmountCents: mapped.netAmountCents ?? undefined,
              currency: mapped.currency ?? undefined,
              fundingSpeed: mapped.fundingSpeed ?? undefined,
              bankAccountLast4: mapped.bankAccountLast4 ?? undefined,
              bankAccountType: mapped.bankAccountType ?? undefined,
              bankName: mapped.bankName ?? undefined,
              accountHolderName: mapped.accountHolderName ?? undefined,
              destinationPaymentInstrumentId: mapped.destinationPaymentInstrumentId ?? undefined,
              failureCode: mapped.failureCode ?? undefined,
              failureMessage: mapped.failureMessage ?? undefined,
              traceId: mapped.traceId ?? undefined,
              estimatedArrivalDate: mapped.estimatedArrivalDate ?? undefined,
              sentAt: mapped.sentAt ?? undefined,
              arrivedAt: mapped.arrivedAt ?? undefined,
              rawJsonRedacted: redactFinixPayload(merchantTransfer),
              updatedAtFinix: mapped.updatedAtFinix ?? undefined,
              lastSyncedAt: new Date(),
            },
          });
        }
      }
    } catch (err) {
      // Funding-transfer endpoint is unconfirmed (see client.ts comment) —
      // a 404/unexpected-shape failure here must not fail the whole
      // refresh; the settlement itself was already synced above, and the
      // caller falls back to whatever's already in FinixFundingTransferAttempt.
      console.error(`Settlement funding-transfer refresh failed for ${finixSettlementId}:`, err);
    }

    if (process.env.FINIX_SYNC_DEBUG === "true") {
      const currentDeposit = await prisma.finixFundingTransferAttempt.findFirst({
        where: { finixSettlementId, churchId },
        orderBy: { createdAtFinix: "desc" },
      });
      console.info("Finix settlement sync", {
        settlementId: finixSettlementId,
        merchantId: finixMerchantId,
        settlementStatus: settlement?.status ?? null,
        fundingTransferCount: hasFundingTransferData ? 1 : 0,
        merchantDepositState: currentDeposit?.state ?? null,
        destinationLast4: currentDeposit?.bankAccountLast4 ?? null,
      });
    }

    return { refreshed: true, hasFundingTransferData };
  } catch (err) {
    console.error(`Settlement live refresh failed for ${finixSettlementId}:`, err);
    return { refreshed: false, hasFundingTransferData: false, error: err instanceof Error ? err.message : String(err) };
  }
}
