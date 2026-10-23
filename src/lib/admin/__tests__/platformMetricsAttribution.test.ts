import { describe, it, expect, vi, beforeEach } from "vitest";

const queries: string[] = [];

function sqlText(strings: TemplateStringsArray, values: unknown[]): string {
  return strings
    .reduce((out, s, i) => {
      const v = values[i];
      const piece = v && typeof v === "object" && "sql" in (v as object) ? String((v as { sql: string }).sql) : i < values.length ? "?" : "";
      return out + s + piece;
    }, "")
    .replace(/\s+/g, " ");
}

const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
  queries.push(sqlText(strings, values));
  return [];
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: queryRaw,
    finixRefundOrReversal: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    bankReturn: { aggregate: vi.fn().mockResolvedValue({ _sum: { amountCents: 0 } }) },
    church: { count: vi.fn().mockResolvedValue(0) },
  },
}));

describe("platform metrics — transfers with no known organization never count as volume", () => {
  beforeEach(() => {
    queries.length = 0;
  });

  it("every volume query requires the transfer to belong to an existing organization; only the unattributed query selects the opposite", async () => {
    const { loadPlatformMetrics, resolveAdminPeriod } = await import("@/lib/admin/platformMetrics");
    await loadPlatformMetrics(resolveAdminPeriod("ytd", new Date("2026-10-23T12:00:00Z")));

    const volumeQueries = queries.filter((q) => q.includes('FROM "FinixTransfer"') && !q.includes("COUNT(DISTINCT"));
    const unattributed = volumeQueries.filter((q) => q.includes("NOT EXISTS"));
    const attributed = volumeQueries.filter((q) => !q.includes("NOT EXISTS"));

    expect(unattributed).toHaveLength(1);
    expect(attributed.length).toBeGreaterThanOrEqual(3);
    for (const q of attributed) {
      expect(q).toContain('EXISTS (SELECT 1 FROM "Church"');
    }
  });

  it("returns the unattributed total as its own figure instead of folding it into processed", async () => {
    queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
      const text = sqlText(strings, values);
      queries.push(text);
      if (text.includes("NOT EXISTS")) return [{ amount: BigInt(57277), count: BigInt(7) }];
      return [];
    });
    const { loadPlatformMetrics, resolveAdminPeriod } = await import("@/lib/admin/platformMetrics");
    const metrics = await loadPlatformMetrics(resolveAdminPeriod("ytd", new Date("2026-10-23T12:00:00Z")));

    expect(metrics.unattributed).toEqual({ amountCents: 57277, count: 7 });
    expect(metrics.processed).toEqual({ amountCents: 0, count: 0 });
  });
});
