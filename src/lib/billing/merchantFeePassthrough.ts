import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { resolveProcessingMerchant, buildTrustedFinixTags, buildIdempotencyKey } from "@/lib/billing/paymentRouting";
import { logBillingAuditEvent } from "@/lib/billing/billingAudit";

export class FeePassthroughError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeePassthroughError";
  }
}

export interface ChargeActor {
  userId: string;
  email?: string | null;
  role?: string | null;
}

// Matches Finix's Default Merchant Fee Profile exactly. NOC (Notification
// of Change, $3.00) is deliberately not included — there is no webhook/model
// capturing NOC events anywhere in this codebase yet, so nothing triggers a
// flag for it. Chargeback Inquiry ($30, same as Notification) is also not
// separately flagged — Finix's dispute webhook payload doesn't distinguish
// an inquiry from a full dispute in what this codebase currently stores on
// FinixDispute, so every dispute is flagged once at the Notification amount
// rather than guessing which of the two (or both) actually applied.
export const FEE_PASSTHROUGH_AMOUNTS_CENTS: Record<string, number> = {
  CHARGEBACK_NOTIFICATION: 3000,
  ACH_RETURN: 500,
};

/**
 * Called from the Finix dispute webhook handler right after a FinixDispute
 * row is created. Never called on update — a dispute can be synced/updated
 * many times as it progresses (evidence submitted, outcome decided); the
 * $30 notification fee is a one-time cost tied to the dispute's creation,
 * not its resolution. The @@unique([sourceType, sourceId]) constraint makes
 * this safe to call more than once for the same dispute (e.g. a retried
 * webhook) — a duplicate insert attempt is just swallowed.
 */
export async function flagChargebackFee(organizationId: string, disputeId: string) {
  try {
    await prisma.merchantFeePassthroughCharge.create({
      data: {
        organizationId,
        feeType: "CHARGEBACK_NOTIFICATION",
        sourceType: "DISPUTE",
        sourceId: disputeId,
        amountCents: FEE_PASSTHROUGH_AMOUNTS_CENTS.CHARGEBACK_NOTIFICATION,
      },
    });
  } catch (err: unknown) {
    // P2002 = unique constraint violation (already flagged for this dispute) — expected on webhook retries, not a real error.
    if (!(err && typeof err === "object" && "code" in err && err.code === "P2002")) throw err;
  }
}

/** Called from the bank-return sync/webhook handler right after a BankReturn row is created. Same one-time, idempotent-by-unique-constraint pattern as flagChargebackFee. */
export async function flagAchReturnFee(organizationId: string, bankReturnId: string) {
  try {
    await prisma.merchantFeePassthroughCharge.create({
      data: {
        organizationId,
        feeType: "ACH_RETURN",
        sourceType: "BANK_RETURN",
        sourceId: bankReturnId,
        amountCents: FEE_PASSTHROUGH_AMOUNTS_CENTS.ACH_RETURN,
      },
    });
  } catch (err: unknown) {
    if (!(err && typeof err === "object" && "code" in err && err.code === "P2002")) throw err;
  }
}

/**
 * Admin-triggered ONLY — mirrors chargePromoShortfall's exact design (see
 * promoShortfallCharge.ts): flagging never auto-charges, a human must
 * explicitly review and approve each charge before real money moves.
 * Charges the org's on-file WGC billing payment method through the WGC
 * platform-billing merchant (never the organization's own donor-facing
 * merchant) — the only mechanism this codebase actually has to collect
 * something from an organization outside of a donation flow; Finix computes
 * and pays out each organization's own settlement directly, WGC has no
 * lever to alter that payout amount itself.
 */
export async function chargeFeePassthrough(chargeId: string, actor: ChargeActor) {
  const charge = await prisma.merchantFeePassthroughCharge.findUnique({ where: { id: chargeId } });
  if (!charge) {
    throw new FeePassthroughError("Fee passthrough record not found.");
  }
  if (charge.status === "CHARGED") {
    return charge; // already done — not an error, just a no-op
  }
  if (charge.status === "WAIVED") {
    throw new FeePassthroughError("This fee was already waived — cannot charge a waived record.");
  }

  const subscription = await prisma.wgcSubscription.findUnique({ where: { organizationId: charge.organizationId } });
  if (!subscription?.billingPaymentInstrumentId) {
    throw new FeePassthroughError("This organization has no billing payment method on file — cannot charge.");
  }

  const resolved = await resolveProcessingMerchant("WGC_PLATFORM_SUBSCRIPTION", charge.organizationId);
  const idempotencyKey = buildIdempotencyKey("fee-passthrough", charge.id);
  const tags = buildTrustedFinixTags({
    organizationId: charge.organizationId,
    chargeType: "WGC_PLATFORM_SUBSCRIPTION",
    subscriptionId: subscription.id,
  });

  let transfer: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- untyped Finix response, matches finix/client.ts convention
  try {
    transfer = await finixClient.createTransfer({
      merchant: resolved.merchantId,
      amount: charge.amountCents,
      currency: charge.currency,
      source: subscription.billingPaymentInstrumentId,
      idempotency_id: idempotencyKey,
      statement_descriptor: "WGC FEE",
      tags: { ...tags, fee_passthrough_id: charge.id, fee_type: charge.feeType },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.merchantFeePassthroughCharge.update({
      where: { id: chargeId },
      data: { status: "CHARGE_FAILED", failureMessage: message },
    });
    await logBillingAuditEvent({
      organizationId: charge.organizationId,
      actorUserId: actor.userId,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: "fee_passthrough.charge_failed",
      entityType: "MerchantFeePassthroughCharge",
      entityId: charge.id,
      internalReason: message,
      metadata: { feeType: charge.feeType, amountCents: charge.amountCents },
    });
    throw new FeePassthroughError(`Finix charge failed: ${message}`);
  }

  const billingCharge = await prisma.billingCharge.create({
    data: {
      organizationId: charge.organizationId,
      chargeType: "BILLING_ADJUSTMENT",
      amountCents: charge.amountCents,
      currency: charge.currency,
      finixTransferId: transfer.id,
      finixSubscriptionId: subscription.finixSubscriptionId,
      idempotencyKey: crypto.randomUUID(),
      status: String(transfer.state || "").toUpperCase() === "SUCCEEDED" ? "SUCCEEDED" : "PENDING",
      internalNote: `${charge.feeType} pass-through fee (source: ${charge.sourceType} ${charge.sourceId}). Triggered by ${actor.email || actor.userId}.`,
      succeededAt: String(transfer.state || "").toUpperCase() === "SUCCEEDED" ? new Date() : null,
    },
  });

  const updated = await prisma.merchantFeePassthroughCharge.update({
    where: { id: chargeId },
    data: {
      status: "CHARGED",
      finixTransferId: transfer.id,
      billingChargeId: billingCharge.id,
      chargedByUserId: actor.userId,
      chargedAt: new Date(),
    },
  });

  await logBillingAuditEvent({
    organizationId: charge.organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "fee_passthrough.charged",
    entityType: "MerchantFeePassthroughCharge",
    entityId: charge.id,
    newValue: { finixTransferId: transfer.id, amountCents: charge.amountCents, feeType: charge.feeType },
    metadata: { billingChargeId: billingCharge.id },
  });

  return updated;
}

export async function waiveFeePassthrough(chargeId: string, actor: ChargeActor, reason: string) {
  const charge = await prisma.merchantFeePassthroughCharge.findUnique({ where: { id: chargeId } });
  if (!charge) {
    throw new FeePassthroughError("Fee passthrough record not found.");
  }
  if (charge.status === "CHARGED") {
    throw new FeePassthroughError("This fee was already charged — cannot waive a charged record.");
  }
  if (charge.status === "WAIVED") {
    return charge;
  }

  const updated = await prisma.merchantFeePassthroughCharge.update({
    where: { id: chargeId },
    data: { status: "WAIVED", waivedByUserId: actor.userId, waivedAt: new Date(), waiveReason: reason },
  });

  await logBillingAuditEvent({
    organizationId: charge.organizationId,
    actorUserId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: "fee_passthrough.waived",
    entityType: "MerchantFeePassthroughCharge",
    entityId: charge.id,
    internalReason: reason,
    metadata: { feeType: charge.feeType },
  });

  return updated;
}
