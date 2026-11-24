import { describe, it, expect } from "vitest";
import {
  addressSummary,
  billingAddress,
  buildInstrumentPanelProps,
  cardBinFromRaw,
  countryFlag,
  countryName,
  maskedCardNumber,
  normalizeCardBrand,
  verificationTone,
  walletLabel,
} from "../cardDisplay";

const card = {
  state: "ENABLED",
  paymentMethodType: "PAYMENT_CARD",
  cardBrand: "MASTERCARD",
  cardType: "DEBIT",
  cardLast4: "4444",
  cardExpirationMonth: 5,
  cardExpirationYear: 2029,
  accountHolderName: "Jordan Ellis",
  securityCodeVerification: "MATCHED",
  addressVerification: "POSTAL_CODE_AND_STREET_MATCH",
  issuerCountry: "USA",
  rawJsonRedacted: { bin: "555555", created_via: "API", address: { line1: "1 Main Street", city: "Springfield", region: "KS", postal_code: "68423", country: "USA" } },
};

describe("card display helpers", () => {
  it("maps Finix brands to the four networks, and everything else to other", () => {
    expect(normalizeCardBrand("VISA")).toBe("visa");
    expect(normalizeCardBrand("MASTERCARD")).toBe("mastercard");
    expect(normalizeCardBrand("DISCOVER")).toBe("discover");
    expect(normalizeCardBrand("AMERICAN_EXPRESS")).toBe("amex");
    expect(normalizeCardBrand("DINERS_CLUB")).toBe("other");
    expect(normalizeCardBrand(null)).toBe("other");
  });

  it("reads the BIN from the stored payload only when it is 6 to 8 digits", () => {
    expect(cardBinFromRaw({ bin: "555555" })).toBe("555555");
    expect(cardBinFromRaw({ bin: "5555" })).toBeNull();
    expect(cardBinFromRaw({ bin: "55555a" })).toBeNull();
    expect(cardBinFromRaw(null)).toBeNull();
  });

  it("formats the masked number with and without a BIN", () => {
    expect(maskedCardNumber("555555", "4444")).toBe("555555 ····· 4444");
    expect(maskedCardNumber(null, "4444")).toBe("····· 4444");
  });

  it("labels wallets, countries and addresses", () => {
    expect(walletLabel("APPLE_PAY")).toBe("Apple Pay");
    expect(walletLabel("GOOGLE_PAY")).toBe("Google Pay");
    expect(walletLabel("PAYMENT_CARD")).toBeNull();
    expect(countryName("USA")).toBe("United States");
    expect(countryName("US")).toBe("United States");
    expect(countryName("ZZZ")).toBe("ZZZ");
    expect(countryFlag("USA")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(countryFlag("ZZZ")).toBe("");
    expect(addressSummary(card.rawJsonRedacted)).toBe("USA, 68423");
    expect(addressSummary(null, "USA")).toBe("USA");
    expect(billingAddress(card.rawJsonRedacted)).toBe("1 Main Street, Springfield, KS 68423, USA");
  });

  it("colors verification results: match green, mismatch amber, unknown grey", () => {
    expect(verificationTone("MATCHED")).toBe("good");
    expect(verificationTone("POSTAL_CODE_AND_STREET_MATCH")).toBe("good");
    expect(verificationTone("NO_MATCH")).toBe("warn");
    expect(verificationTone("NOT_MATCHED")).toBe("warn");
    expect(verificationTone("UNKNOWN")).toBe("neutral");
    expect(verificationTone(null)).toBe("neutral");
  });
});

describe("buildInstrumentPanelProps", () => {
  it("builds the card graphic and rows for a debit card", () => {
    const p = buildInstrumentPanelProps(card, "Oct 19, 2026 9:17 AM");
    expect(p.isBank).toBe(false);
    expect(p.brand).toBe("mastercard");
    expect(p.kindLabel).toBe("Debit");
    expect(p.number).toBe("555555 ····· 4444");
    expect(p.expiry).toBe("05/29");
    expect(p.rows.map((r) => r.label)).toEqual(["State", "Type", "Address", "Issuer Country", "Created", "CVV Verification", "Address Verification"]);
    expect(p.rows[0]).toMatchObject({ value: "Enabled", check: true });
    expect(p.rows.find((r) => r.label === "CVV Verification")).toMatchObject({ value: "Matched", tone: "good" });
    expect(p.moreRows.map((r) => r.label)).toEqual(["Brand", "Card BIN", "Billing Address", "Created Via"]);
  });

  it("names the wallet in the type and on the card", () => {
    const p = buildInstrumentPanelProps({ ...card, paymentMethodType: "APPLE_PAY", cardType: "CREDIT" }, "x");
    expect(p.rows.find((r) => r.label === "Type")?.value).toBe("Apple Pay");
    expect(p.kindLabel).toBe("Credit · Apple Pay");
  });

  it("works without a stored payload: no BIN, no address detail, no crash", () => {
    const p = buildInstrumentPanelProps({ ...card, rawJsonRedacted: null, issuerCountry: null, addressCountry: "USA" }, "x");
    expect(p.number).toBe("····· 4444");
    expect(p.moreRows.map((r) => r.label)).not.toContain("Card BIN");
    expect(p.rows.find((r) => r.label === "Address")?.value).toBe("USA");
  });

  it("shows a bank account without card-only rows", () => {
    const p = buildInstrumentPanelProps({ state: "ENABLED", bankLast4: "6789", bankAccountType: "CHECKING", accountHolderName: "Org Inc", rawJsonRedacted: null }, "x");
    expect(p.isBank).toBe(true);
    expect(p.brandLabel).toBe("Bank account");
    expect(p.kindLabel).toBe("Checking");
    expect(p.rows.map((r) => r.label)).toEqual(["State", "Type", "Created"]);
    expect(p.expiry).toBeNull();
  });
});
