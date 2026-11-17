import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { generateAgentCode, looksLikeAgentCode, isValidAgentEmail } from "../agents";
import { uniqueCopies } from "../statusEmailCopies";
import { agentSummaryCsv, organizationDetailCsv, summarizeByAgent, UNASSIGNED_AGENT, type AgentReportRow } from "../partnerAgentReport";
import { normalizePartnerRole } from "../partnerSession";

const row = (over: Partial<AgentReportRow>): AgentReportRow => ({
  agentId: "a1", agentName: "Amy", agentEmail: "amy@sparrow.io", churchId: "c1", organization: "Grace Church", reference: "", status: "Active",
  boardedAt: "2026-11-03", boardedInWindow: true, cardCents: 100_00, cardCount: 2, achCents: 50_00, achCount: 1, otherCents: 0, otherCount: 0,
  refundsCents: 10_00, refundsCount: 1, achReturnsCents: 5_00, achReturnsCount: 1, wgcFeeChargedCents: 4_00, ...over,
});

describe("agent codes", () => {
  it("generates codes that look valid, and rejects other values", () => {
    expect(looksLikeAgentCode(generateAgentCode())).toBe(true);
    expect(looksLikeAgentCode("ob_abcdefghijklmnopqrst")).toBe(false);
    expect(looksLikeAgentCode(undefined)).toBe(false);
  });
  it("validates agent emails", () => {
    expect(isValidAgentEmail("a@b.co")).toBe(true);
    expect(isValidAgentEmail("a@b.co, c@d.co")).toBe(false);
    expect(isValidAgentEmail("nope")).toBe(false);
  });
});

describe("status email copies", () => {
  it("lower-cases, de-duplicates and drops the primary recipient and blanks", () => {
    expect(uniqueCopies(["Team@Sparrow.io", "team@sparrow.io", null, "", "Merchant@x.org", "agent@sparrow.io"], "merchant@x.org")).toEqual(["team@sparrow.io", "agent@sparrow.io"]);
  });
});

describe("partner role", () => {
  it("only REPORTS narrows access; anything else is ADMIN", () => {
    expect(normalizePartnerRole("REPORTS")).toBe("REPORTS");
    expect(normalizePartnerRole("ADMIN")).toBe("ADMIN");
    expect(normalizePartnerRole(undefined)).toBe("ADMIN");
  });
});

describe("agent report", () => {
  const rows = [
    row({}),
    row({ churchId: "c2", organization: "Hope Fund", boardedInWindow: false, cardCents: 200_00, refundsCents: 0, achReturnsCents: 0, wgcFeeChargedCents: 6_00 }),
    row({ agentId: null, agentName: UNASSIGNED_AGENT, agentEmail: "", churchId: "c3", organization: "Orphan", status: "Terminated", cardCents: 1_00 }),
  ];

  it("sums per agent and puts organizations with no agent last", () => {
    const s = summarizeByAgent(rows);
    expect(s.map((r) => r.agentName)).toEqual(["Amy", UNASSIGNED_AGENT]);
    expect(s[0]).toMatchObject({ organizationsTotal: 2, organizationsActive: 2, boardedInWindow: 1, cardCents: 300_00, wgcFeeChargedCents: 10_00 });
    expect(s[1]).toMatchObject({ organizationsTotal: 1, organizationsActive: 0 });
  });

  it("writes card, ACH, refunds, returns and net volume in dollars", () => {
    const csv = agentSummaryCsv(summarizeByAgent(rows)).split("\n");
    expect(csv[0]).toContain("Card volume (USD)");
    // Amy: card 300.00, ACH 100.00, refunds 10.00, returns 5.00 -> net 385.00
    expect(csv[1]).toBe("Amy,amy@sparrow.io,2,2,1,300.00,4,100.00,2,0.00,400.00,10.00,5.00,385.00,10.00");
  });

  it("neutralizes spreadsheet formulas in organization names", () => {
    const csv = organizationDetailCsv([row({ organization: "=HYPERLINK(\"http://evil\")" })]);
    expect(csv.split("\n")[1]).toContain("\"'=HYPERLINK");
  });
});
