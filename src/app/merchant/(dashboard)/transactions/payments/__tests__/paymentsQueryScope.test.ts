import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const SOURCE = readFileSync(join(__dirname, "../page.tsx"), "utf-8");

describe("Merchant Payments list — transferScope's OR must survive the query", () => {
  it("does not spread a second top-level OR key that would silently overwrite transferScope's settlement-exclusion OR", () => {
    // Regression guard: `{ ...transferScope, OR: [...] }` overwrites
    // transferScope's own OR key via object spread, which let
    // SETTLEMENT_* Finix transfers (no donor, no Payment row) leak back
    // into this donor-facing list. The return-exclusion OR must be
    // nested inside AND instead.
    const whereBlock = SOURCE.slice(SOURCE.indexOf("prisma.finixTransfer.findMany"), SOURCE.indexOf("orderBy: { createdAtFinix"));
    const topLevelKeys = whereBlock.match(/^\s{6}(\.\.\.\w+|\w+):/gm) || [];
    const orKeyCount = topLevelKeys.filter((k) => k.trim() === "OR:").length;
    expect(orKeyCount).toBe(0);
    expect(whereBlock).toContain("...transferScope");
    expect(whereBlock).toContain("AND: [");
  });
});
