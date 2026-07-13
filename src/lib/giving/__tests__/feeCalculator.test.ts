import { describe, it, expect } from "vitest";
import {
  calculateDynamicSupplementalFee,
  normalizeCardBrand,
  CARD_FEE_CONFIG,
  PREMIUM_CARD_FIXED_FEE_CENTS,
} from "../feeCalculator";

describe("normalizeCardBrand", () => {
  it("should normalize common card brands", () => {
    expect(normalizeCardBrand("visa")).toBe("VISA");
    expect(normalizeCardBrand("Visa ")).toBe("VISA");
    expect(normalizeCardBrand("MasterCard")).toBe("MASTERCARD");
    expect(normalizeCardBrand("master_card")).toBe("MASTERCARD");
    expect(normalizeCardBrand("mc")).toBe("MASTERCARD");
    expect(normalizeCardBrand("American Express")).toBe("AMERICAN_EXPRESS");
    expect(normalizeCardBrand("AMEX")).toBe("AMERICAN_EXPRESS");
    expect(normalizeCardBrand("discover")).toBe("DISCOVER");
    expect(normalizeCardBrand(null)).toBe("UNKNOWN");
    expect(normalizeCardBrand("")).toBe("UNKNOWN");
    expect(normalizeCardBrand("RandomBrand")).toBe("UNKNOWN");
  });
});

describe("calculateDynamicSupplementalFee", () => {
  describe("Visa & Discover & Default pricing (2.30% + $0.30)", () => {
    it("should calculate correctly for $100 Visa donation when donor covers fee", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "CARD",
        cardBrand: "VISA",
        donorCoversFee: true,
      });

      // 10000 * 2.3% = 230 cents
      // 230 + 30 fixed = 260 cents total fee
      expect(result.processingFeeCents).toBe(260);
      expect(result.donorChargeAmountCents).toBe(10260);
      expect(result.supplementalFeeCents).toBe(260);
      expect(result.merchantExpectedNetCents).toBe(10000);
      expect(result.percentageBps).toBe(230);
      expect(result.fixedFeeCents).toBe(30);
      expect(result.normalizedCardBrand).toBe("VISA");
    });

    it("should calculate correctly for $100 Visa donation when donor does not cover fee", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "CARD",
        cardBrand: "VISA",
        donorCoversFee: false,
      });

      expect(result.processingFeeCents).toBe(260);
      expect(result.donorChargeAmountCents).toBe(10000);
      expect(result.supplementalFeeCents).toBe(260);
      expect(result.merchantExpectedNetCents).toBe(9740); // 10000 - 260
    });
  });

  describe("Mastercard & Amex pricing (3.50% + PREMIUM_CARD_FIXED_FEE_CENTS)", () => {
    it("should calculate correctly for $100 Mastercard donation when donor covers fee", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "CARD",
        cardBrand: "MASTERCARD",
        donorCoversFee: true,
      });

      // 10000 * 3.5% = 350 cents
      // 350 + PREMIUM_CARD_FIXED_FEE_CENTS (currently 0) = 350 cents total fee
      const expectedFee = 350 + PREMIUM_CARD_FIXED_FEE_CENTS;
      expect(result.processingFeeCents).toBe(expectedFee);
      expect(result.donorChargeAmountCents).toBe(10000 + expectedFee);
      expect(result.supplementalFeeCents).toBe(expectedFee);
      expect(result.merchantExpectedNetCents).toBe(10000);
    });

    it("should calculate correctly for $100 Amex donation when donor does not cover fee", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "CARD",
        cardBrand: "AMEX",
        donorCoversFee: false,
      });

      const expectedFee = 350 + PREMIUM_CARD_FIXED_FEE_CENTS;
      expect(result.processingFeeCents).toBe(expectedFee);
      expect(result.donorChargeAmountCents).toBe(10000);
      expect(result.merchantExpectedNetCents).toBe(10000 - expectedFee);
    });
  });

  describe("ACH / Bank pricing", () => {
    it("should use flat 25 cents fee, no percentage, and no card brand behavior", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "ACH",
        donorCoversFee: true,
      });

      expect(result.processingFeeCents).toBe(25);
      expect(result.donorChargeAmountCents).toBe(10025);
      expect(result.supplementalFeeCents).toBe(25);
      expect(result.merchantExpectedNetCents).toBe(10000);
      expect(result.percentageBps).toBe(0);
      expect(result.fixedFeeCents).toBe(25);
    });
  });

  describe("Fallback behavior & error handling", () => {
    it("should fall back to default fee for unknown brands", () => {
      const result = calculateDynamicSupplementalFee({
        donationAmountCents: 10000,
        paymentMethod: "CARD",
        cardBrand: "UNKNOWN_BRAND_ABC",
        donorCoversFee: true,
      });

      expect(result.normalizedCardBrand).toBe("UNKNOWN");
      expect(result.percentageBps).toBe(230);
      expect(result.fixedFeeCents).toBe(30);
      expect(result.processingFeeCents).toBe(260);
    });

    it("should throw error for negative donation amount", () => {
      expect(() => {
        calculateDynamicSupplementalFee({
          donationAmountCents: -500,
          paymentMethod: "CARD",
          donorCoversFee: true,
        });
      }).toThrow("Donation amount cannot be negative");
    });
  });
});
