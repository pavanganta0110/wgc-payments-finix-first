/**
 * Payment-method-split aggregation, layered on top of the exact eligibility
 * rules donorAggregates.ts already exports (externalDonationEligibilityWhere,
 * finixTransferEligibilityWhere) rather than redefining "what counts as a
 * real donation." One batched query per source, aggregated in Node only
 * after Postgres has already narrowed to the exact candidate donor set —
 * the same pattern loadDonorAggregatesBatch itself uses internally, not a
 * new one.
 *
 * SCOPE NOTE (see final report "remaining issues"): these are GROSS
 * per-method figures. The authoritative NET figure (gross - refunds -
 * returns) is computed at the whole-donor level by
 * donorAggregates.loadDonorAggregatesBatch and is what Reporting's
 * lifetimeGivingCents/periodGivingCents/netGivingCents columns show —
 * this module only answers "how much of that gross came in as card vs ACH
 * vs cash vs check vs in-kind," not a per-method net.
 */
import { prisma } from "@/lib/prisma";
import { externalDonationEligibilityWhere, type DateRangeFilter } from "@/lib/donors/donorAggregates";

export interface PaymentMethodBreakdown {
  cardGivingCents: number;
  achGivingCents: number;
  cashGivingCents: number;
  checkGivingCents: number;
  externalOtherGivingCents: number; // Zelle/Cash App/PayPal/bank transfer/terminal/money order
  inKindValueCents: number;
}

export const EMPTY_BREAKDOWN: PaymentMethodBreakdown = {
  cardGivingCents: 0,
  achGivingCents: 0,
  cashGivingCents: 0,
  checkGivingCents: 0,
  externalOtherGivingCents: 0,
  inKindValueCents: 0,
};

// ExternalDonation has no dedicated "in-kind" paymentMethod value (confirmed
// against the schema) — the existing convention for a non-cash-equivalent
// gift is paymentMethod "OTHER" with a donationPurpose/otherPaymentMethodName
// noting the in-kind nature. Centralized here so every reporting surface
// applies the same heuristic rather than each guessing independently.
export function isInKindExternalDonation(row: { paymentMethod: string; otherPaymentMethodName?: string | null; donationPurpose?: string | null }): boolean {
  if (row.paymentMethod !== "OTHER") return false;
  const haystack = `${row.otherPaymentMethodName || ""} ${row.donationPurpose || ""}`.toLowerCase();
  return haystack.includes("in-kind") || haystack.includes("in kind") || haystack.includes("inkind");
}

export async function loadPaymentMethodBreakdownBatch(
  donorIds: string[],
  churchId: string,
  dateFilter?: DateRangeFilter,
  attributedUserId?: string,
): Promise<Map<string, PaymentMethodBreakdown>> {
  const result = new Map<string, PaymentMethodBreakdown>(donorIds.map((id) => [id, { ...EMPTY_BREAKDOWN }]));
  if (donorIds.length === 0) return result;

  const instruments = await prisma.finixPaymentInstrumentSnapshot.findMany({
    where: { churchId, donorId: { in: donorIds } },
    select: { finixPaymentInstrumentId: true, donorId: true, paymentMethodType: true },
  });
  const instrumentMeta = new Map(instruments.map((i) => [i.finixPaymentInstrumentId, i]));
  const instrumentIds = [...instrumentMeta.keys()];

  const [transfers, externalRows] = await Promise.all([
    instrumentIds.length
      ? prisma.finixTransfer.findMany({
          where: {
            churchId,
            finixPaymentInstrumentId: { in: instrumentIds },
            state: "SUCCEEDED",
            ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
          },
          select: { finixPaymentInstrumentId: true, amountCents: true },
        })
      : Promise.resolve([]),
    prisma.externalDonation.findMany({
      where: externalDonationEligibilityWhere(churchId, { donorIds, dateFilter, attributedUserId }),
      select: { donorId: true, donationAmountCents: true, paymentMethod: true, otherPaymentMethodName: true, donationPurpose: true, depositStatus: true },
    }),
  ]);

  for (const t of transfers) {
    if (!t.finixPaymentInstrumentId) continue;
    const meta = instrumentMeta.get(t.finixPaymentInstrumentId);
    if (!meta?.donorId) continue;
    const acc = result.get(meta.donorId);
    if (!acc) continue;
    if (meta.paymentMethodType === "BANK_ACCOUNT") acc.achGivingCents += t.amountCents ?? 0;
    else acc.cardGivingCents += t.amountCents ?? 0;
  }

  for (const r of externalRows) {
    if (!r.donorId || r.depositStatus === "RETURNED") continue;
    const acc = result.get(r.donorId);
    if (!acc) continue;
    if (isInKindExternalDonation(r)) {
      acc.inKindValueCents += r.donationAmountCents;
    } else if (r.paymentMethod === "CASH") {
      acc.cashGivingCents += r.donationAmountCents;
    } else if (r.paymentMethod === "CHECK") {
      acc.checkGivingCents += r.donationAmountCents;
    } else {
      acc.externalOtherGivingCents += r.donationAmountCents;
    }
  }

  return result;
}
