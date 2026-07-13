import { describe, it, expect } from "vitest";
import { selectMerchantFundingTransfer, mapFundingTransferFields, isFreshEnoughToApply } from "@/lib/finix/sync/settlementFundingSync";

describe("selectMerchantFundingTransfer", () => {
  it("returns null when there are no funding transfers", () => {
    expect(selectMerchantFundingTransfer([], "MUmerchant123")).toBeNull();
  });

  it("returns the single non-platform transfer when there's exactly one and no merchant id to match", () => {
    const transfer = { id: "ft_1", merchant: "MUmerchant123" };
    expect(selectMerchantFundingTransfer([transfer], null)).toBe(transfer);
  });

  it("matches the transfer whose merchant field equals the given finixMerchantId — the merchant vs platform deposit distinction", () => {
    const merchantTransfer = { id: "ft_merchant", merchant: "MUmerchant123" };
    const platformTransfer = { id: "ft_platform", merchant: "MUplatform999", type: "PLATFORM_DEPOSIT" };
    const result = selectMerchantFundingTransfer([platformTransfer, merchantTransfer], "MUmerchant123");
    expect(result).toBe(merchantTransfer);
  });

  it("excludes anything explicitly marked as a platform deposit even without a merchant id filter", () => {
    const platformTransfer = { id: "ft_platform", type: "PLATFORM_DEPOSIT" };
    expect(selectMerchantFundingTransfer([platformTransfer], null)).toBeNull();
  });

  it("does not guess when multiple non-platform candidates exist and none match the merchant id", () => {
    const a = { id: "ft_a", merchant: "MUother1" };
    const b = { id: "ft_b", merchant: "MUother2" };
    expect(selectMerchantFundingTransfer([a, b], "MUmerchant123")).toBeNull();
  });

  it("matches via merchant_id or linked_to as fallback field names", () => {
    const transfer = { id: "ft_1", merchant_id: "MUmerchant123" };
    expect(selectMerchantFundingTransfer([transfer], "MUmerchant123")).toBe(transfer);
  });
});

describe("mapFundingTransferFields", () => {
  it("maps the exact sandbox scenario fields correctly", () => {
    const raw = {
      state: "SUCCEEDED",
      amount: 140792,
      bank_name: "Chase",
      account_type: "CHECKING",
      masked_account_number: "6789",
      destination: "PIdestination123",
    };
    const mapped = mapFundingTransferFields(raw);
    expect(mapped.state).toBe("SUCCEEDED");
    expect(mapped.amountCents).toBe(140792);
    expect(mapped.bankName).toBe("Chase");
    expect(mapped.bankAccountType).toBe("CHECKING");
    expect(mapped.bankAccountLast4).toBe("6789");
    expect(mapped.destinationPaymentInstrumentId).toBe("PIdestination123");
  });

  it("never includes a full account or routing number field — only ever the masked last four", () => {
    const raw = {
      state: "SUCCEEDED",
      amount: 100,
      masked_account_number: "6789",
      // Even if a raw response somehow included these, mapFundingTransferFields must not surface them.
      account_number: "000123456789",
      routing_number: "021000021",
    };
    const mapped = mapFundingTransferFields(raw);
    const mappedKeys = Object.keys(mapped);
    expect(mappedKeys).not.toContain("accountNumber");
    expect(mappedKeys).not.toContain("routingNumber");
    expect(JSON.stringify(mapped)).not.toContain("000123456789");
    expect(JSON.stringify(mapped)).not.toContain("021000021");
  });

  it("falls back gracefully when fields are missing", () => {
    const mapped = mapFundingTransferFields({});
    expect(mapped.state).toBeNull();
    expect(mapped.bankAccountLast4).toBeNull();
  });
});

describe("isFreshEnoughToApply", () => {
  it("allows applying when there is no existing timestamp", () => {
    expect(isFreshEnoughToApply(null, new Date("2026-01-01"))).toBe(true);
  });

  it("allows applying when the incoming timestamp is missing (defaults to trusting the sync)", () => {
    expect(isFreshEnoughToApply(new Date("2026-01-01"), null)).toBe(true);
  });

  it("rejects an out-of-order (older) incoming update", () => {
    const existing = new Date("2026-01-02T12:00:00Z");
    const incoming = new Date("2026-01-01T12:00:00Z");
    expect(isFreshEnoughToApply(existing, incoming)).toBe(false);
  });

  it("allows a newer incoming update", () => {
    const existing = new Date("2026-01-01T12:00:00Z");
    const incoming = new Date("2026-01-02T12:00:00Z");
    expect(isFreshEnoughToApply(existing, incoming)).toBe(true);
  });

  it("allows an equal timestamp (idempotent re-delivery of the same event)", () => {
    const same = new Date("2026-01-01T12:00:00Z");
    expect(isFreshEnoughToApply(same, same)).toBe(true);
  });
});
