import { describe, it, expect } from "vitest";
import { extractUpdateDataRequests, formFieldForFinixField } from "../parseVerificationOutcomes";

describe("extractUpdateDataRequests", () => {
  it("returns update-data outcomes, skips file uploads and dedupes repeats", () => {
    const v = {
      outcomes: [
        { outcome_message: " Provide a website ", remediation_details: { type: "UPDATE_DATA", field_name: "url" } },
        { outcome_message: "Ownership invalid", remediation_details: { field_name: "principal_percentage_ownership" } },
        { outcome_message: "Ownership invalid", remediation_details: { field_name: "principal_percentage_ownership" } },
        { outcome_message: "Upload a bill", remediation_details: { type: "FILE_UPLOAD", file_type: "BANK_STATEMENT_ONE_MONTH", field_name: "ignored" } },
        { outcome_message: "no remediation" },
      ],
    };
    expect(extractUpdateDataRequests(v)).toEqual([
      { fieldName: "url", message: "Provide a website" },
      { fieldName: "principal_percentage_ownership", message: "Ownership invalid" },
    ]);
  });
  it("tolerates a missing or malformed verification", () => {
    expect(extractUpdateDataRequests(null)).toEqual([]);
    expect(extractUpdateDataRequests({ outcomes: "nope" })).toEqual([]);
  });
});

describe("formFieldForFinixField", () => {
  it("maps known Finix fields (with or without an entity. prefix) to the form's inputs", () => {
    expect(formFieldForFinixField("entity.url")).toBe("website");
    expect(formFieldForFinixField("tax_id")).toBe("ssn");
    expect(formFieldForFinixField("personal_address")).toBe("address");
    expect(formFieldForFinixField("business_phone")).toBe("businessPhone");
  });
  it("returns null for fields the form has no input for so they surface in the note prompt", () => {
    expect(formFieldForFinixField("business_address")).toBeNull();
    expect(formFieldForFinixField("dob")).toBeNull();
  });
});
