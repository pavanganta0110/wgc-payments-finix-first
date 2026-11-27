import { finixClient } from "@/lib/finix/client";

export type AssignFeeProfileResult =
  | { status: "ASSIGNED"; merchantProfileId: string; feeProfileId: string }
  | { status: "SKIPPED_NOT_CONFIGURED" }
  | { status: "FAILED"; error: string };

/**
 * Puts a newly created merchant on WGC's own default Fee Profile
 * (WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID) instead of leaving it on whatever
 * the Finix application's default was on the day it signed up. That profile
 * carries the merchant-level fees, notably the $0.50 per-payout settlement
 * fee: without it Finix still charges WGC for every payout but bills the
 * merchant nothing (9 of 27 payouts in Sep 2026).
 *
 * Never throws: onboarding must not fail because pricing couldn't be set.
 * A failure leaves the merchant on Finix's default and is logged loudly so
 * it can be fixed in the Finix dashboard.
 */
export async function assignDefaultMerchantFeeProfile(merchant: { id: string; merchant_profile?: string | null }): Promise<AssignFeeProfileResult> {
  const feeProfileId = process.env.WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID;
  if (!feeProfileId) {
    console.warn("ONBOARDING_STEP", "MERCHANT_FEE_PROFILE_SKIPPED", { merchantId: merchant.id, reason: "WGC_MERCHANT_DEFAULT_FEE_PROFILE_ID not set" });
    return { status: "SKIPPED_NOT_CONFIGURED" };
  }
  try {
    const merchantProfileId = merchant.merchant_profile || (await finixClient.getMerchant(merchant.id))?.merchant_profile;
    if (!merchantProfileId) throw new Error("Finix returned no merchant_profile for this merchant.");
    await finixClient.setMerchantProfileFeeProfile(merchantProfileId, feeProfileId);
    console.log("ONBOARDING_STEP", "MERCHANT_FEE_PROFILE_ASSIGNED", { merchantId: merchant.id, merchantProfileId, feeProfileId });
    return { status: "ASSIGNED", merchantProfileId, feeProfileId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("ONBOARDING_FAILED", { step: "MERCHANT_FEE_PROFILE_ASSIGN_FAILED", merchantId: merchant.id, feeProfileId, errorMessage: error });
    return { status: "FAILED", error };
  }
}
