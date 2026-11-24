import { instrumentStateLabel, titleCaseFromSnake } from "@/lib/finix/displayFormatters";

/**
 * Display helpers for the Payment Instrument panel (card graphic plus its detail rows). Pure and
 * shared by the admin and merchant payment pages. Nothing here fetches or stores anything: the
 * card's first six digits (BIN) are read from the Finix payload already kept on the instrument
 * snapshot (rawJsonRedacted.bin), which is a masked value and never a full card number.
 */

export type CardBrandKey = "visa" | "mastercard" | "discover" | "amex" | "other";

export const CARD_BRAND_LABEL: Record<CardBrandKey, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  discover: "Discover",
  amex: "American Express",
  other: "Card",
};

export function normalizeCardBrand(brand: string | null | undefined): CardBrandKey {
  const b = (brand ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (b === "VISA") return "visa";
  if (b === "MASTERCARD" || b === "MC") return "mastercard";
  if (b === "DISCOVER") return "discover";
  if (b === "AMERICANEXPRESS" || b === "AMEX") return "amex";
  return "other";
}

/** Tint and text colors for the card graphic, one per brand. Dark text on a light tint, 4.5:1 or better. */
export const CARD_THEMES: Record<CardBrandKey, { from: string; to: string; ink: string; sub: string; shadow: string }> = {
  visa: { from: "#DCE4FB", to: "#C6D2F5", ink: "#10163F", sub: "#26306B", shadow: "rgba(40,70,170,0.16)" },
  mastercard: { from: "#F9DDE2", to: "#F4CBD3", ink: "#2A0F18", sub: "#5B1A2A", shadow: "rgba(190,60,90,0.16)" },
  discover: { from: "#FCE6D2", to: "#F8D3B3", ink: "#2C1708", sub: "#6B3410", shadow: "rgba(200,110,40,0.16)" },
  amex: { from: "#D8E9F8", to: "#BFD9F0", ink: "#0B2236", sub: "#14416B", shadow: "rgba(30,100,170,0.16)" },
  other: { from: "#E7EBF1", to: "#D5DBE5", ink: "#0F172A", sub: "#334155", shadow: "rgba(15,23,42,0.12)" },
};

/** The first 6 to 8 digits Finix keeps on a card instrument, or null when absent or not numeric. */
export function cardBinFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const bin = (raw as Record<string, unknown>).bin;
  return typeof bin === "string" && /^\d{6,8}$/.test(bin) ? bin : null;
}

const DOTS = "·····";

/** "555555 ····· 4444", or "····· 4444" when the BIN is not known. */
export function maskedCardNumber(bin: string | null | undefined, last4: string | null | undefined): string {
  const tail = last4 || "----";
  return bin ? `${bin} ${DOTS} ${tail}` : `${DOTS} ${tail}`;
}

export function walletLabel(paymentMethodType: string | null | undefined): string | null {
  const t = (paymentMethodType ?? "").toUpperCase();
  if (t === "APPLE_PAY") return "Apple Pay";
  if (t === "GOOGLE_PAY") return "Google Pay";
  return null;
}

export function cardTypeLabel(cardType: string | null | undefined): string | null {
  const t = (cardType ?? "").toUpperCase();
  if (t === "DEBIT") return "Debit";
  if (t === "CREDIT") return "Credit";
  if (t === "PREPAID") return "Prepaid";
  return null;
}

const ALPHA3_TO_ALPHA2: Record<string, string> = {
  USA: "US", CAN: "CA", MEX: "MX", GBR: "GB", AUS: "AU", NZL: "NZ", IRL: "IE", DEU: "DE", FRA: "FR", ESP: "ES", ITA: "IT",
  NLD: "NL", BRA: "BR", IND: "IN", CHN: "CN", JPN: "JP", KOR: "KR", PHL: "PH", PRI: "PR", ZAF: "ZA", KEN: "KE", NGA: "NG",
};

function toAlpha2(code: string | null | undefined): string | null {
  const c = (code ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(c)) return c;
  return ALPHA3_TO_ALPHA2[c] ?? null;
}

/** "United States" for "USA" or "US"; the raw code when it is not one we know; "—" when empty. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "—";
  const a2 = toAlpha2(code);
  if (!a2) return code;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(a2) ?? code;
  } catch {
    return code;
  }
}

/** Flag emoji for a country code, or "" when unknown. */
export function countryFlag(code: string | null | undefined): string {
  const a2 = toAlpha2(code);
  if (!a2) return "";
  return String.fromCodePoint(...[...a2].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

type RawAddress = { line1?: string | null; line2?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country?: string | null };

function rawAddress(raw: unknown): RawAddress | null {
  if (!raw || typeof raw !== "object") return null;
  const a = (raw as Record<string, unknown>).address;
  return a && typeof a === "object" ? (a as RawAddress) : null;
}

/** "USA, 68423": the short form shown in the main rows. */
export function addressSummary(raw: unknown, fallbackCountry?: string | null): string {
  const a = rawAddress(raw);
  const parts = [a?.country || fallbackCountry, a?.postal_code].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : "—";
}

/** "1 Main Street, Springfield, KS 68423, USA": the full billing address for the Show more section. */
export function billingAddress(raw: unknown): string {
  const a = rawAddress(raw);
  if (!a) return "—";
  const stateZip = [a.region, a.postal_code].filter(Boolean).join(" ");
  const parts = [a.line1, a.line2, a.city, stateZip, a.country].filter((p): p is string => !!p);
  return parts.length ? parts.join(", ") : "—";
}

export type PillTone = "good" | "warn" | "neutral";

/** Green for a match, amber for a mismatch or failure, grey when the issuer did not check or say. */
export function verificationTone(value: string | null | undefined): PillTone {
  const v = (value ?? "").toUpperCase();
  if (!v || /^(UNKNOWN|UNAVAILABLE|NOT_CHECKED|UNSUPPORTED|NOT_SUPPORTED)/.test(v)) return "neutral";
  if (/(NO_MATCH|NOT_MATCH|MISMATCH|FAIL)/.test(v)) return "warn";
  if (v.includes("MATCH")) return "good";
  return "neutral";
}

export interface InstrumentRow {
  label: string;
  value: string;
  tone?: PillTone;
  /** Shown before the value (a flag emoji). */
  prefix?: string;
  /** Show a green check beside the value (the Enabled state). */
  check?: boolean;
}

export interface InstrumentPanelProps {
  isBank: boolean;
  brand: CardBrandKey;
  brandLabel: string;
  /** Debit, Credit, Prepaid, or a bank account type; shown at the top right of the card graphic. */
  kindLabel: string | null;
  holder: string | null;
  number: string;
  expiry: string | null;
  rows: InstrumentRow[];
  moreRows: InstrumentRow[];
}

export interface InstrumentSource {
  state?: string | null;
  paymentMethodType?: string | null;
  cardBrand?: string | null;
  cardType?: string | null;
  cardLast4?: string | null;
  cardExpirationMonth?: number | null;
  cardExpirationYear?: number | null;
  bankLast4?: string | null;
  bankAccountType?: string | null;
  accountHolderName?: string | null;
  securityCodeVerification?: string | null;
  addressVerification?: string | null;
  issuerCountry?: string | null;
  addressCountry?: string | null;
  disabledMessage?: string | null;
  rawJsonRedacted?: unknown;
}

function expiryLabel(month: number | null | undefined, year: number | null | undefined): string | null {
  if (!month || !year) return null;
  return `${String(month).padStart(2, "0")}/${String(year % 100).padStart(2, "0")}`;
}

/** Everything the panel shows, as plain strings, so the same panel serves the admin and merchant pages. */
export function buildInstrumentPanelProps(instrument: InstrumentSource, createdLabel: string): InstrumentPanelProps {
  const raw = instrument.rawJsonRedacted;
  const isBank = !!instrument.bankLast4 && !instrument.cardLast4;
  const brand = isBank ? "other" : normalizeCardBrand(instrument.cardBrand);
  const wallet = walletLabel(instrument.paymentMethodType);
  const bin = cardBinFromRaw(raw);
  const createdVia = raw && typeof raw === "object" ? (raw as Record<string, unknown>).created_via : null;

  const typeLabel = isBank ? "Bank Account" : wallet ?? "Card";
  const rows: InstrumentRow[] = [
    { label: "State", value: instrumentStateLabel(instrument.state), check: (instrument.state ?? "").toUpperCase() === "ENABLED" },
    { label: "Type", value: typeLabel },
  ];
  if (!isBank) {
    rows.push({ label: "Address", value: addressSummary(raw, instrument.addressCountry) });
    if (instrument.issuerCountry) {
      rows.push({ label: "Issuer Country", value: countryName(instrument.issuerCountry), prefix: countryFlag(instrument.issuerCountry) });
    }
  }
  rows.push({ label: "Created", value: createdLabel });
  if (instrument.securityCodeVerification) {
    rows.push({ label: "CVV Verification", value: titleCaseFromSnake(instrument.securityCodeVerification), tone: verificationTone(instrument.securityCodeVerification) });
  }
  if (instrument.addressVerification) {
    rows.push({ label: "Address Verification", value: titleCaseFromSnake(instrument.addressVerification), tone: verificationTone(instrument.addressVerification) });
  }

  const moreRows: InstrumentRow[] = [];
  if (!isBank) {
    moreRows.push({ label: "Brand", value: CARD_BRAND_LABEL[brand] === "Card" && instrument.cardBrand ? titleCaseFromSnake(instrument.cardBrand) : CARD_BRAND_LABEL[brand] });
    if (bin) moreRows.push({ label: "Card BIN", value: bin });
    moreRows.push({ label: "Billing Address", value: billingAddress(raw) });
  } else if (instrument.bankAccountType) {
    moreRows.push({ label: "Account Type", value: titleCaseFromSnake(instrument.bankAccountType) });
  }
  if (typeof createdVia === "string" && createdVia) moreRows.push({ label: "Created Via", value: titleCaseFromSnake(createdVia) });
  if (instrument.disabledMessage) moreRows.push({ label: "Disabled Reason", value: instrument.disabledMessage });

  return {
    isBank,
    brand,
    brandLabel: isBank ? "Bank account" : CARD_BRAND_LABEL[brand],
    kindLabel: isBank ? (instrument.bankAccountType ? titleCaseFromSnake(instrument.bankAccountType) : null) : [cardTypeLabel(instrument.cardType), wallet].filter(Boolean).join(" · ") || null,
    holder: instrument.accountHolderName || null,
    number: isBank ? `${DOTS} ${instrument.bankLast4}` : maskedCardNumber(bin, instrument.cardLast4),
    expiry: isBank ? null : expiryLabel(instrument.cardExpirationMonth, instrument.cardExpirationYear),
    rows,
    moreRows,
  };
}
