import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockFinix = { getMerchant: vi.fn(), setMerchantProfileFeeProfile: vi.fn() };
vi.mock("@/lib/finix/client", () => ({ finixClient: mockFinix }));

const { assignDefaultMerchantFeeProfile } = await import("../assignMerchantFeeProfile");

describe("assignDefaultMerchantFeeProfile", () => {
  const original = process.env.WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID = "FPwgcDefault";
  });
  afterEach(() => {
    process.env.WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID = original;
  });

  it("PUTs the fee profile on the merchant profile from the create response", async () => {
    mockFinix.setMerchantProfileFeeProfile.mockResolvedValue({});
    const result = await assignDefaultMerchantFeeProfile({ id: "MU1", merchant_profile: "MP1" });
    expect(result).toEqual({ status: "ASSIGNED", merchantProfileId: "MP1", feeProfileId: "FPwgcDefault" });
    expect(mockFinix.getMerchant).not.toHaveBeenCalled();
    expect(mockFinix.setMerchantProfileFeeProfile).toHaveBeenCalledWith("MP1", "FPwgcDefault");
  });

  it("looks up the merchant profile when the create response lacks it", async () => {
    mockFinix.getMerchant.mockResolvedValue({ id: "MU1", merchant_profile: "MP9" });
    mockFinix.setMerchantProfileFeeProfile.mockResolvedValue({});
    await assignDefaultMerchantFeeProfile({ id: "MU1" });
    expect(mockFinix.setMerchantProfileFeeProfile).toHaveBeenCalledWith("MP9", "FPwgcDefault");
  });

  it("skips without calling Finix when not configured", async () => {
    delete process.env.WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID;
    expect(await assignDefaultMerchantFeeProfile({ id: "MU1", merchant_profile: "MP1" })).toEqual({ status: "SKIPPED_NOT_CONFIGURED" });
    expect(mockFinix.setMerchantProfileFeeProfile).not.toHaveBeenCalled();
  });

  it("never throws when Finix rejects the update", async () => {
    mockFinix.setMerchantProfileFeeProfile.mockRejectedValue(new Error("422 invalid fee_profile"));
    const result = await assignDefaultMerchantFeeProfile({ id: "MU1", merchant_profile: "MP1" });
    expect(result).toEqual({ status: "FAILED", error: "422 invalid fee_profile" });
  });
});
