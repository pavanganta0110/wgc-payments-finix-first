import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { parseFinixDate } from "@/lib/finix/parseFinixDate";
import { formatPersonName } from "@/lib/formatPersonName";
import { calculateWgcFeeAmounts } from "@/lib/giving/feeCalculator";

const TERMS_VERSION = "2026-01-recurring-admin-update-v1";

/**
 * Thrown once Finix has confirmed EITHER half of this two-call operation —
 * the old subscription's cancellation, or the replacement's creation — and
 * something after that point failed. A caller catching this must NEVER
 * mark its own SubscriptionAction FAILED and encourage a blind retry with
 * a brand-new idempotencyKey (that could call createSubscription again
 * with no relationship to the already-canceled old one). The safe recovery
 * is always to retry recreateSubscriptionWithChange() itself with the SAME
 * idempotencyKey — see that function's own retry-safety comment for why
 * this is sound even when the old subscription is already canceled.
 * Mirrors PAYMENT_STATUS_UNCERTAIN elsewhere in this codebase.
 */
export class SubscriptionFinixConfirmedError extends Error {
  constructor(message: string, public readonly finixSubscriptionId: string) {
    super(message);
    this.name = "SubscriptionFinixConfirmedError";
  }
}

/**
 * Finix's subscriptions API has no in-place update endpoint — confirmed in
 * src/lib/finix/client.ts, which only exposes create/get/cancel. "Update
 * Amount" and "Update Frequency" are therefore implemented as cancel the
 * old schedule + create a new one with the changed term, chained via
 * supersedesSubscriptionId/supersededBySubscriptionId so the UI can show
 * "replaced by"/"replaces" instead of two unrelated rows, and a fresh
 * SubscriptionConsent is recorded for the new terms (the old consent record
 * for the canceled subscription is never mutated or deleted).
 */
export async function recreateSubscriptionWithChange(params: {
  churchId: string;
  actorUserId: string;
  oldSubscription: { id: string; finixSubscriptionId: string; donorId: string | null; finixPaymentInstrumentId: string | null; givingLinkId: string | null; fundId: string | null; amountCents: number | null; billingInterval: string | null };
  newAmountCents?: number;
  newBillingInterval?: string;
  // The caller's own SubscriptionAction.idempotencyKey — sent to Finix as
  // the new subscription's idempotency_id (defense in depth alongside the
  // caller's own DB-level claim on that key).
  idempotencyKey: string;
}) {
  const { churchId, actorUserId, oldSubscription, newAmountCents, newBillingInterval, idempotencyKey } = params;

  if (!oldSubscription.donorId || !oldSubscription.finixPaymentInstrumentId) {
    throw new Error("This subscription is missing donor or payment method information");
  }

  const [donor, instrument, church, oldSubRecord] = await Promise.all([
    prisma.donor.findFirst({ where: { id: oldSubscription.donorId, churchId } }),
    prisma.finixPaymentInstrumentSnapshot.findFirst({ where: { finixPaymentInstrumentId: oldSubscription.finixPaymentInstrumentId, churchId } }),
    prisma.church.findUnique({ where: { id: churchId } }),
    prisma.finixSubscription.findUnique({ where: { id: oldSubscription.id } }),
  ]);
  if (!donor) throw new Error("Donor not found");
  if (!instrument?.finixIdentityId) throw new Error("Payment method not found");
  if (!church?.finixMerchantId) throw new Error("Organization is not fully onboarded");

  const donorCoversFee = oldSubRecord?.donorCoversFee ?? false;
  const baseAmountCents = newAmountCents ?? oldSubRecord?.donationAmountCents ?? oldSubscription.amountCents ?? 0;
  const billingInterval = newBillingInterval ?? oldSubscription.billingInterval ?? "MONTHLY";

  const feeRes = calculateWgcFeeAmounts({
    donationAmountCents: baseAmountCents,
    paymentMethod: instrument.paymentMethodType === "bank" ? "ACH" : "CARD",
    cardBrand: instrument.cardBrand || null,
    donorCoversFee,
  });
  const finalAmountCents = donorCoversFee ? feeRes.amountToChargeCents : baseAmountCents;

  // Retry-safety: if a PRIOR call already got as far as canceling the old
  // subscription (recorded below) but failed before creating the
  // replacement, a retry with the same idempotencyKey must not call
  // cancelSubscription() a second time — Finix's behavior canceling an
  // already-canceled subscription is unverified from this environment
  // (deliberately redacted Finix credentials), so this never depends on it
  // being a safe no-op. createSubscription()'s own idempotency_id already
  // makes that half of the retry safe on its own.
  const alreadyCanceled = oldSubRecord?.state === "CANCELED" && oldSubRecord?.supersededBySubscriptionId == null;
  const cancelOutcomeUncertain = oldSubRecord?.state === "CANCEL_UNCERTAIN";
  if (cancelOutcomeUncertain) {
    // A prior attempt's cancelSubscription() call itself got an ambiguous
    // error — WGC does not know whether Finix actually canceled the old
    // subscription. Re-issuing DELETE on an already-canceled subscription
    // is unverified from this environment (same caveat as elsewhere), and
    // silently proceeding to create a replacement risks the donor ending
    // up with TWO active recurring schedules if the old one never
    // actually canceled. Requires manual verification in the Finix
    // dashboard before this can proceed.
    throw new SubscriptionFinixConfirmedError(
      "A previous cancellation attempt for this subscription timed out and its outcome is unknown — please verify in the Finix dashboard before retrying.",
      oldSubscription.finixSubscriptionId
    );
  }
  if (!alreadyCanceled) {
    // Cancel the old Finix subscription first — if this fails with a
    // DEFINITE (non-ambiguous) error, nothing else happens and the caller
    // sees a clean failure with the original schedule still intact. An
    // AMBIGUOUS error (timeout/network) means WGC doesn't know whether
    // Finix actually processed the cancellation — that must never surface
    // as a plain Error a caller could read as "nothing happened, safe to
    // retry from scratch" (the exact same class of bug this whole fix was
    // written to close, just one call earlier).
    try {
      await finixClient.cancelSubscription(oldSubscription.finixSubscriptionId);
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const ambiguous = msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort") || msg.includes("econnreset") || msg.includes("network");
      if (!ambiguous) throw err; // a definite rejection — nothing happened, safe to propagate as-is
      await prisma.finixSubscription
        .update({ where: { id: oldSubscription.id }, data: { state: "CANCEL_UNCERTAIN", lastSyncedAt: new Date() } })
        .catch((writeErr) => console.error(`Failed to record CANCEL_UNCERTAIN for subscription ${oldSubscription.id}:`, writeErr));
      throw new SubscriptionFinixConfirmedError(
        err instanceof Error ? err.message : "Ambiguous error canceling the old subscription — outcome unknown",
        oldSubscription.finixSubscriptionId
      );
    }

    // Persisted IMMEDIATELY, before the replacement is even attempted —
    // previously this write only happened inside the try/transaction below,
    // AFTER createSubscription succeeded. If createSubscription then threw
    // a plain error, the old subscription was already durably canceled on
    // Finix's side while the local dashboard kept showing it ACTIVE
    // indefinitely (cold-review moderate finding — a silent state
    // divergence, not a double-charge, but a real "the donor's recurring
    // gift silently stopped and nothing shows it" bug).
    try {
      await prisma.finixSubscription.update({
        where: { id: oldSubscription.id },
        data: { canceledAt: new Date(), cancelReason: "Replaced by amount/frequency update", canceledByUserId: actorUserId, state: "CANCELED", lastSyncedAt: new Date() },
      });
    } catch (writeError) {
      console.error(`Failed to record old subscription ${oldSubscription.id} as canceled after Finix confirmed the cancellation:`, writeError);
      throw new SubscriptionFinixConfirmedError(
        writeError instanceof Error ? writeError.message : "Local write failed after Finix confirmed the old subscription was canceled",
        oldSubscription.finixSubscriptionId
      );
    }
  }

  let finixSubscription;
  try {
    finixSubscription = await finixClient.createSubscription({
      amount: finalAmountCents,
      currency: "USD",
      billing_interval: billingInterval as any,
      linked_to: church.finixMerchantId,
      linked_type: "MERCHANT",
      buyer_details: { identity_id: instrument.finixIdentityId, instrument_id: instrument.finixPaymentInstrumentId },
      idempotency_id: idempotencyKey,
      tags: { source: "wgc_admin_updated", churchId, donorId: oldSubscription.donorId },
    });
  } catch (err) {
    // The old subscription is ALREADY confirmed-canceled by this point
    // (either just now, or on a prior attempt) — this is never a clean
    // "nothing happened" failure. A retry with the same idempotencyKey is
    // the correct recovery (see the alreadyCanceled branch above).
    throw new SubscriptionFinixConfirmedError(
      err instanceof Error ? err.message : "Failed to create replacement subscription after the old one was already canceled",
      oldSubscription.finixSubscriptionId
    );
  }
  if (!finixSubscription?.id) {
    throw new SubscriptionFinixConfirmedError("Failed to create replacement subscription after the old one was already canceled", oldSubscription.finixSubscriptionId);
  }

  // From here, Finix has both canceled the old schedule and confirmed a
  // real replacement subscription — any failure below must surface as
  // SubscriptionFinixConfirmedError, never a plain Error a caller might
  // treat as "nothing happened, safe to retry."
  try {
    const [canceledOld, newRecord] = await prisma.$transaction([
      prisma.finixSubscription.update({
        where: { id: oldSubscription.id },
        data: { canceledAt: new Date(), cancelReason: "Replaced by amount/frequency update", canceledByUserId: actorUserId, state: "CANCELED", supersededBySubscriptionId: finixSubscription.id, lastSyncedAt: new Date() },
      }),
      // upsert (keyed on finixSubscriptionId @unique) — atomic against a
      // concurrent writer for this same new subscription (a raced retry,
      // or a subscription webhook arriving first), never a bare create.
      prisma.finixSubscription.upsert({
        where: { finixSubscriptionId: finixSubscription.id },
        create: {
          finixSubscriptionId: finixSubscription.id,
          churchId,
          donorId: oldSubscription.donorId,
          fundId: oldSubscription.fundId,
          givingLinkId: oldSubscription.givingLinkId,
          finixMerchantId: church.finixMerchantId,
          finixBuyerIdentityId: instrument.finixIdentityId,
          finixPaymentInstrumentId: instrument.finixPaymentInstrumentId,
          state: finixSubscription.state ?? "ACTIVE",
          amountCents: finalAmountCents,
          currency: "USD",
          billingInterval,
          collectionMethod: "BILL_AUTOMATICALLY",
          nextBillingDate: parseFinixDate(finixSubscription.next_billing_date),
          startedAt: new Date(),
          createdByUserId: actorUserId,
          consentSource: "ADMIN_CONFIRMED",
          supersedesSubscriptionId: oldSubscription.id,
          donationAmountCents: baseAmountCents,
          donorCoversFee,
          feeCalculationVersion: "v1",
          lastSyncedAt: new Date(),
        },
        update: { state: finixSubscription.state ?? undefined, lastSyncedAt: new Date() },
      }),
    ]);

    const donorName = donor.anonymousPreference ? "Anonymous Donor" : formatPersonName(donor.name);
    await prisma.subscriptionConsent.create({
      data: {
        churchId,
        donorId: oldSubscription.donorId,
        finixSubscriptionId: finixSubscription.id,
        consentSource: "ADMIN_CONFIRMED",
        confirmedByUserId: actorUserId,
        termsVersion: TERMS_VERSION,
        recurringTermsSnapshot: { amountCents: finalAmountCents, billingInterval, replacesFinixSubscriptionId: oldSubscription.finixSubscriptionId },
        donorNameSnapshot: donorName,
        donorEmailSnapshot: donor.email,
        amountCentsSnapshot: finalAmountCents,
        frequencySnapshot: billingInterval,
        startDateSnapshot: new Date(),
        paymentMethodLastFourSnapshot: instrument.cardLast4 || instrument.bankLast4 || null,
        organizationNameSnapshot: church.name,
      },
    });

    return { oldSubscriptionId: canceledOld.id, newSubscription: newRecord };
  } catch (writeError) {
    console.error(`Post-confirmation write failed after Finix confirmed replacement subscription ${finixSubscription.id}:`, writeError);
    throw new SubscriptionFinixConfirmedError(
      writeError instanceof Error ? writeError.message : "Local write failed after Finix confirmed the replacement subscription",
      finixSubscription.id
    );
  }
}
