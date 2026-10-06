import { describe, it, expect } from "vitest";
import { normalizePhone, normalizeSsn, normalizeWebsite, parseUpdateRequestFields, redactSsnLike } from "../updateRequestFields";

describe("normalizers", () => {
  it("normalizes websites and rejects junk", () => {
    expect(normalizeWebsite("lighthousebaptist.org")).toBe("https://lighthousebaptist.org");
    expect(normalizeWebsite("http://example.com/path/")).toBe("http://example.com/path");
    expect(normalizeWebsite("not a url")).toBeNull();
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
  });
  it("normalizes US phone numbers to 10 digits", () => {
    expect(normalizePhone("(816) 555-0142")).toBe("8165550142");
    expect(normalizePhone("+1 816 555 0142")).toBe("8165550142");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("1235550142")).toBeNull();
  });
  it("accepts a plausible SSN and rejects ranges SSA never issues", () => {
    expect(normalizeSsn("123-45-6789")).toBe("123456789");
    expect(normalizeSsn("123 45 6789")).toBe("123456789");
    expect(normalizeSsn("000-12-3456")).toBeNull();
    expect(normalizeSsn("666-12-3456")).toBeNull();
    expect(normalizeSsn("900-12-3456")).toBeNull();
    expect(normalizeSsn("123-00-6789")).toBeNull();
    expect(normalizeSsn("123-45-0000")).toBeNull();
    expect(normalizeSsn("12-3456789")).toBeNull();
  });
});

describe("parseUpdateRequestFields", () => {
  it("returns an empty update when nothing is filled in", () => {
    expect(parseUpdateRequestFields({})).toEqual({ entity: {}, fieldNames: [], error: null });
  });

  it("maps everything to Finix's entity fields and lists names only", () => {
    const r = parseUpdateRequestFields({
      website: "lighthousebaptist.org",
      businessPhone: "816-555-0142",
      principalSsn: "123-45-6789",
      addressLine1: "12 Elm St",
      addressLine2: "Apt 4",
      city: "Kansas City",
      state: "mo",
      postalCode: "64101",
      removeOwnership: true,
    });
    expect(r.error).toBeNull();
    expect(r.entity).toEqual({
      url: "https://lighthousebaptist.org",
      business_phone: "8165550142",
      tax_id: "123456789",
      personal_address: { line1: "12 Elm St", line2: "Apt 4", city: "Kansas City", region: "MO", postal_code: "64101", country: "USA" },
      principal_percentage_ownership: null,
    });
    expect(r.fieldNames).toEqual(["Website", "Business phone", "Principal SSN", "Principal residential address", "Ownership percentage removed"]);
    expect(JSON.stringify(r.fieldNames)).not.toMatch(/\d{9}/);
  });

  it("rejects a partial address, a bad state and a bad ZIP", () => {
    expect(parseUpdateRequestFields({ addressLine1: "12 Elm St" }).error).toMatch(/complete the residential address/);
    expect(parseUpdateRequestFields({ addressLine1: "1", city: "KC", state: "Missouri", postalCode: "64101" }).error).toMatch(/2-letter/);
    expect(parseUpdateRequestFields({ addressLine1: "1", city: "KC", state: "MO", postalCode: "6410" }).error).toMatch(/ZIP/);
  });

  it("reports the first invalid field and returns no entity at all", () => {
    const r = parseUpdateRequestFields({ website: "ok.org", principalSsn: "123" });
    expect(r.error).toMatch(/Social Security/);
    expect(r.entity).toEqual({});
  });
});

describe("redactSsnLike", () => {
  it("removes SSN-shaped numbers from messages", () => {
    expect(redactSsnLike("bad tax_id 123-45-6789 and 987654321")).toBe("bad tax_id [REDACTED] and [REDACTED]");
  });
});
