import { prisma } from "@/lib/prisma";

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

// =========================================================================
// Dynamic Supplemental Fees (v1 Pricing System)
// =========================================================================

export const PREMIUM_CARD_FIXED_FEE_CENTS = 0; // Configurable: can change from 0 to 30

export const CARD_FEE_CONFIG = {
  VISA: {
    percentageBps: 230,
    fixedFeeCents: 30,
  },
  DISCOVER: {
    percentageBps: 230,
    fixedFeeCents: 30,
  },
  MASTERCARD: {
    percentageBps: 350,
    fixedFeeCents: PREMIUM_CARD_FIXED_FEE_CENTS,
  },
  AMERICAN_EXPRESS: {
    percentageBps: 350,
    fixedFeeCents: PREMIUM_CARD_FIXED_FEE_CENTS,
  },
  DEFAULT: {
    percentageBps: 230,
    fixedFeeCents: 30,
  },
} as const;

export type FeeCalculationInput = {
  donationAmountCents: number;
  paymentMethod: "CARD" | "ACH";
  cardBrand?: string | null;
  donorCoversFee: boolean;
};

export type FeeCalculationResult = {
  donationAmountCents: number;
  processingFeeCents: number;
  donorChargeAmountCents: number;
  supplementalFeeCents: number;
  merchantExpectedNetCentsCents: number;
  merchantExpectedNetCents: number;
  percentageBps: number;
  fixedFeeCents: number;
  normalizedCardBrand: string;
};

/**
 * Normalizes card brand strings into one of the supported config keys:
 * VISA, MASTERCARD, AMERICAN_EXPRESS, DISCOVER, UNKNOWN
 */
export function normalizeCardBrand(brand: string | null | undefined): string {
  if (!brand) return "UNKNOWN";
  const b = brand.toUpperCase().trim().replace(/[\s_-]+/g, "_");
  if (b.includes("VISA")) return "VISA";
  if (b.includes("MASTERCARD") || b.includes("MASTER_CARD") || b.includes("MC")) return "MASTERCARD";
  if (b.includes("AMEX") || b.includes("AMERICAN_EXPRESS") || b.includes("AMERICANEXPRESS")) return "AMERICAN_EXPRESS";
  if (b.includes("DISCOVER")) return "DISCOVER";
  return "UNKNOWN";
}

/**
 * Server-side dynamic fee calculation. Calculates fees in integer cents.
 */
export function calculateDynamicSupplementalFee(input: FeeCalculationInput): FeeCalculationResult {
  const { donationAmountCents, paymentMethod, cardBrand, donorCoversFee } = input;

  if (donationAmountCents < 0) {
    throw new Error("Donation amount cannot be negative");
  }

  let percentageBps = 0;
  let fixedFeeCents = 0;
  let normalizedCardBrand = "";

  if (paymentMethod === "ACH") {
    // Preserve current ACH behavior: flat fixed fee (e.g. 25 cents), no percentage
    percentageBps = 0;
    fixedFeeCents = DEFAULT_ACH_FIXED_FEE_CENTS;
  } else {
    normalizedCardBrand = normalizeCardBrand(cardBrand);
    const config = CARD_FEE_CONFIG[normalizedCardBrand as keyof typeof CARD_FEE_CONFIG] || CARD_FEE_CONFIG.DEFAULT;
    percentageBps = config.percentageBps;
    fixedFeeCents = config.fixedFeeCents;
  }

  const percentageFeeCents = Math.round((donationAmountCents * percentageBps) / 10000);
  const processingFeeCents = percentageFeeCents + fixedFeeCents;

  let donorChargeAmountCents = 0;
  let supplementalFeeCents = 0;
  let merchantExpectedNetCents = 0;

  if (donorCoversFee) {
    donorChargeAmountCents = donationAmountCents + processingFeeCents;
    supplementalFeeCents = processingFeeCents;
    merchantExpectedNetCents = donationAmountCents;
  } else {
    donorChargeAmountCents = donationAmountCents;
    supplementalFeeCents = processingFeeCents;
    merchantExpectedNetCents = donationAmountCents - processingFeeCents;
  }

  return {
    donationAmountCents,
    processingFeeCents,
    donorChargeAmountCents,
    supplementalFeeCents,
    merchantExpectedNetCentsCents: merchantExpectedNetCents, // Add both variations for compat
    merchantExpectedNetCents,
    percentageBps,
    fixedFeeCents,
    normalizedCardBrand,
  };
}

/**
 * Checks if dynamic supplemental fees are enabled for the environment or merchant
 */
export function isDynamicSupplementalFeesEnabled(merchantId: string | null | undefined): boolean {
  const flag = process.env.FINIX_DYNAMIC_SUPPLEMENTAL_FEES_ENABLED;
  if (!flag) return false;
  if (flag === "true") return true;
  if (flag === "sandbox" && process.env.FINIX_ENV === "sandbox") return true;
  if (merchantId) {
    const list = flag.split(",").map((m) => m.trim());
    if (list.includes(merchantId)) return true;
  }
  return false;
}

/**
 * Server-side pricing check to warn when both dynamic supplemental fees
 * and a non-zero fee profile are active for a merchant.
 */
export async function checkPricingWarning(churchId: string, merchantId: string | null | undefined) {
  if (!merchantId) return;
  if (isDynamicSupplementalFeesEnabled(merchantId)) {
    const pricing = await prisma.churchPricing.findUnique({ where: { churchId } });
    if (pricing) {
      const hasNonZeroFees =
        (pricing.cardPercentageFee !== null && pricing.cardPercentageFee !== 0) ||
        (pricing.cardFixedFeeCents !== null && pricing.cardFixedFeeCents !== 0);
      if (hasNonZeroFees) {
        console.warn(
          `[PRICING_WARNING] Church ${churchId} / Merchant ${merchantId} is configured to use full dynamic supplemental fees, ` +
            `but its Finix Merchant Fee Profile is non-zero (cardPercentageFee: ${pricing.cardPercentageFee}%, cardFixedFeeCents: ${pricing.cardFixedFeeCents}c). ` +
            `This could charge the merchant twice!`
        );
      }
    }
  }
}
