import { describe, it, expect } from "vitest";
import { parseVerificationOutcomes } from "../parseVerificationOutcomes";

describe("parseVerificationOutcomes", () => {
  it("formats outcome_code into a readable, bulleted, <br/>-joined list", () => {
    const result = parseVerificationOutcomes({
      outcomes: [
        { outcome_code: "BANK_STATEMENT_ONE_MONTH_REQUESTED" },
        { outcome_code: "BUSINESS_DBA_UPDATE_REQUESTED" },
      ],
    });
    expect(result).toBe("• Bank statement one month requested<br/>• Business dba update requested");
  });

  it("appends remediation_details.field_name in parentheses when present", () => {
    const result = parseVerificationOutcomes({
      outcomes: [{ outcome_code: "INVALID_BUSINESS_TAX_ID", remediation_details: { field_name: "entity.business_tax_id" } }],
    });
    expect(result).toBe("• Invalid business tax id (entity.business_tax_id)");
  });

  it("skips outcomes without a string outcome_code rather than throwing", () => {
    const result = parseVerificationOutcomes({ outcomes: [{}, { outcome_code: 42 }, { outcome_code: "REAL_ONE" }] });
    expect(result).toBe("• Real one");
  });

  it("returns null (not a hardcoded fallback) when outcomes is missing", () => {
    expect(parseVerificationOutcomes({ state: "FAILED" })).toBeNull();
  });

  it("returns null when outcomes is an empty array", () => {
    expect(parseVerificationOutcomes({ outcomes: [] })).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseVerificationOutcomes(null)).toBeNull();
    expect(parseVerificationOutcomes(undefined)).toBeNull();
    expect(parseVerificationOutcomes("not an object")).toBeNull();
  });
});
