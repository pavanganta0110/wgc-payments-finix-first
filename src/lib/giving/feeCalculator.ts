/**
 * "Donor covers the fee" gross-up math. This is not a Finix API feature —
 * Finix (like every processor) only ever charges the amount you send it.
 * Covering the fee means charging the donor a larger total so that after
 * Finix deducts its fee, the church still nets the donor's intended gift.
 *
 * Card (percentage + fixed fee): the classic gross-up formula solves for
 * totalCharged such that totalCharged - (totalCharged * pct + fixedCents) = donationCents.
 *   totalCharged = (donationCents + fixedCents) / (1 - pct)
 *
 * ACH (fixed fee only, no percentage in this app's ChurchPricing model):
 *   totalCharged = donationCents + fixedCents
 */

export const DEFAULT_CARD_PERCENTAGE_FEE = 2.9; // %
export const DEFAULT_CARD_FIXED_FEE_CENTS = 30;
export const DEFAULT_ACH_FIXED_FEE_CENTS = 25;

export function calculateFeeCoveredTotal(
  donationCents: number,
  paymentMethod: "card" | "bank",
  rates: {
    cardPercentageFee?: number | null;
    cardFixedFeeCents?: number | null;
    achFixedFeeCents?: number | null;
  }
): { totalCents: number; feeCoveredCents: number } {
  if (paymentMethod === "bank") {
    const fixed = rates.achFixedFeeCents ?? DEFAULT_ACH_FIXED_FEE_CENTS;
    const totalCents = donationCents + fixed;
    return { totalCents, feeCoveredCents: totalCents - donationCents };
  }

  const pct = (rates.cardPercentageFee ?? DEFAULT_CARD_PERCENTAGE_FEE) / 100;
  const fixed = rates.cardFixedFeeCents ?? DEFAULT_CARD_FIXED_FEE_CENTS;
  const totalCents = Math.round((donationCents + fixed) / (1 - pct));
  return { totalCents, feeCoveredCents: totalCents - donationCents };
}
