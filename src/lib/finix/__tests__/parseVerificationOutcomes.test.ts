import { describe, it, expect } from "vitest";
import { parseVerificationOutcomes } from "../parseVerificationOutcomes";

describe("parseVerificationOutcomes", () => {
  it("prefers outcome_message (the underwriter's actual note) over the machine-oriented outcome_code", () => {
    const result = parseVerificationOutcomes({
      outcomes: [
        { outcome_code: "INVALID_BUSINESS_MCC", outcome_message: "The correct MCC for a religious entity is 8661.  Please update the MCC. \n" },
      ],
    });
    expect(result).toBe("• The correct MCC for a religious entity is 8661. Please update the MCC.");
  });

  it("matches the real production Verification payload for Lighthouse Baptist Church exactly (2026-09-04)", () => {
    const result = parseVerificationOutcomes({
      outcomes: [
        { outcome_code: "INVALID_BUSINESS_DBA", outcome_message: "Please provide a doing business as (DBA). This can be the same as Legal Business name if the business does not go by another name. \n", remediation_details: { type: "FIELD_UPDATE", field_name: "entity.doing_business_as" } },
        { outcome_code: "INVALID_BUSINESS_OWNERSHIP_TYPE", outcome_message: "Please provide an ownership type. \n", remediation_details: { type: "FIELD_UPDATE", field_name: "entity.ownership_type" } },
        { outcome_code: "INVALID_BUSINESS_MCC", outcome_message: "The correct MCC for a religious entity is 8661.  Please update the MCC. \n", remediation_details: { type: "FIELD_UPDATE", field_name: "entity.mcc" } },
        { outcome_code: "EDD_DOCUMENT_REQUESTED", outcome_message: "Please correct the spelling of the email address. There is a typo where it should be org. \n", remediation_details: { type: "FILE_UPLOAD" } },
      ],
    });
    expect(result).toBe(
      "• Please provide a doing business as (DBA). This can be the same as Legal Business name if the business does not go by another name.<br/>" +
      "• Please provide an ownership type.<br/>" +
      "• The correct MCC for a religious entity is 8661. Please update the MCC.<br/>" +
      "• Please correct the spelling of the email address. There is a typo where it should be org."
    );
  });

  it("falls back to the humanized outcome_code when outcome_message is absent", () => {
    const result = parseVerificationOutcomes({ outcomes: [{ outcome_code: "SOME_CODE_WITH_NO_MESSAGE" }] });
    expect(result).toBe("• Some code with no message");
  });

  it("ignores a blank/whitespace-only outcome_message and falls back to outcome_code", () => {
    const result = parseVerificationOutcomes({ outcomes: [{ outcome_code: "FALLBACK_CASE", outcome_message: "   \n  " }] });
    expect(result).toBe("• Fallback case");
  });

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
