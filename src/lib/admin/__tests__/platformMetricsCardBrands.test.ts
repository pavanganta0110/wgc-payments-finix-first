import { describe, it, expect, vi } from "vitest";

function sqlText(strings: TemplateStringsArray, values: unknown[]): string {
  return strings
    .reduce((out, s, i) => {
      const v = values[i];
      const piece = v && typeof v === "object" && "sql" in (v as object) ? String((v as { sql: string }).sql) : i < values.length ? "?" : "";
      return out + s + piece;
    }, "")
    .replace(/\s+/g, " ");
}

// The card breakdown query is the one that selects the card brand.
const breakdownRows = [
  { method: "CARD", card_type: "CREDIT", card_brand: "VISA", amount: BigInt(72113), count: BigInt(10) },
  { method: "CARD", card_type: "CREDIT", card_brand: "MASTERCARD", amount: BigInt(66300), count: BigInt(10) },
  { method: "CARD", card_type: "CREDIT", card_brand: "AMERICAN_EXPRESS", amount: BigInt(54263), count: BigInt(3) },
  { method: "CARD", card_type: "DEBIT", card_brand: "VISA", amount: BigInt(260606), count: BigInt(10) },
  { method: "CARD", card_type: "DEBIT", card_brand: "MASTERCARD", amount: BigInt(32051), count: BigInt(3) },
  { method: "CARD", card_type: "DEBIT", card_brand: null, amount: BigInt(2575), count: BigInt(1) },
  { method: "ACH", card_type: null, card_brand: null, amount: BigInt(28200), count: BigInt(7) },
];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> =>
      sqlText(strings, values).includes("card_brand") ? breakdownRows : [],
    ),
    finixRefundOrReversal: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    bankReturn: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    church: { count: vi.fn().mockResolvedValue(0) },
  },
}));

describe("platform metrics — card network breakdown", () => {
  it("splits each credit/debit type by card network, biggest first, and keeps the type totals", async () => {
    const { loadPlatformMetrics, resolveAdminPeriod } = await import("@/lib/admin/platformMetrics");
    const m = await loadPlatformMetrics(resolveAdminPeriod("ytd", new Date("2026-10-23T12:00:00Z")));

    expect(m.byCardType.CREDIT).toEqual({ amountCents: 192676, count: 23 });
    expect(m.byCardType.DEBIT).toEqual({ amountCents: 295232, count: 14 });

    expect(m.byCardBrand.CREDIT.map((b) => b.brand)).toEqual(["VISA", "MASTERCARD", "AMERICAN_EXPRESS"]);
    expect(m.byCardBrand.DEBIT.map((b) => [b.brand, b.count])).toEqual([
      ["VISA", 10],
      ["MASTERCARD", 3],
      ["UNKNOWN", 1], // a card whose network Finix didn't report is shown, not dropped
    ]);

    // The brand rows add back up to the type total.
    const sum = (rows: { amountCents: number }[]) => rows.reduce((s, r) => s + r.amountCents, 0);
    expect(sum(m.byCardBrand.CREDIT)).toBe(m.byCardType.CREDIT.amountCents);
    expect(sum(m.byCardBrand.DEBIT)).toBe(m.byCardType.DEBIT.amountCents);
    // ACH never appears in the card breakdown.
    expect(m.byMethod.ACH).toEqual({ amountCents: 28200, count: 7 });
  });
});
