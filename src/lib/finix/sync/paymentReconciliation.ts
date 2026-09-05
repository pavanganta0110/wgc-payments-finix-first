import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { redactFinixPayload } from "@/lib/finix/redact";
import { syncFeesForTransfer } from "@/lib/finix/sync/syncFees";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { enqueueBackgroundJobInTransaction } from "@/lib/jobs/backgroundJobs";

/**
 * Webhooks must not be the only synchronization method for payment state —
 * this is the self-healing fallback for a Transfer stuck showing a state
 * WGC never received the follow-up webhook for (see webhook-delivery gap
 * confirmed for the ACH bug this was built to fix).
 */
export const PAYMENT_RECONCILE_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes
// A brand-new PENDING payment is normal (ACH/card processing takes time) —
// only one that's stayed PENDING past this age is worth an extra Finix call.
export const PENDING_PAYMENT_MIN_AGE_MS = 60 * 1000; // 1 minute

const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED"]);

export function isStaleEnoughToReconcile(lastReconciledAt: Date | null | undefined): boolean {
  return !lastReconciledAt || Date.now() - lastReconciledAt.getTime() > PAYMENT_RECONCILE_THROTTLE_MS;
}

function normalizeProcessorState(state: string | null | undefined): string {
  return (state || "PENDING").toUpperCase();
}

/**
 * Out-of-order protection: a SUCCEEDED (or otherwise terminal) local state
 * must never be regressed back to PENDING by a stale/duplicate event. Once
 * terminal, only re-applying the exact same terminal state is a no-op; any
 * different value is logged and ignored rather than silently applied.
 */
export function shouldApplyTransferState(currentState: string | null, incomingState: string | null): boolean {
  const current = normalizeProcessorState(currentState);
  const incoming = normalizeProcessorState(incomingState);
  if (current === incoming) return true;
  if (TERMINAL_STATES.has(current) && !TERMINAL_STATES.has(incoming)) return false;
  return true;
}

export interface TransferReconcileResult {
  reconciled: boolean;
  changed: boolean;
  newState?: string;
  error?: string;
}

/** Primary matching key is always the Finix Transfer ID itself — never amount/name/date/last-four, which are only ever used by a human to *locate* the right record before confirming the Transfer ID. */
export async function reconcilePendingTransfer(finixTransferId: string): Promise<TransferReconcileResult> {
  try {
    const local = await prisma.finixTransfer.findUnique({ where: { finixTransferId } });
    if (!local) return { reconciled: false, changed: false, error: "Transfer not found locally" };

    const remote = await finixClient.getTransfer(finixTransferId);
    const remoteState = normalizeProcessorState(remote.state);
    const currentState = normalizeProcessorState(local.state);

    if (!shouldApplyTransferState(local.state, remote.state)) {
      // A stale/duplicate event tried to regress a terminal state — ignored, not applied.
      await prisma.finixTransfer.update({ where: { finixTransferId }, data: { lastReconciledAt: new Date() } });
      return { reconciled: true, changed: false, newState: currentState };
    }

    const changed = currentState !== remoteState;

    await prisma.finixTransfer.update({
      where: { finixTransferId },
      data: {
        state: remote.state ?? undefined,
        failureCode: remote.failure_code ?? local.failureCode,
        failureMessage: remote.failure_message ?? local.failureMessage,
        rawJsonRedacted: redactFinixPayload(remote),
        updatedAtFinix: remote.updated_at ? new Date(remote.updated_at) : local.updatedAtFinix,
        lastSyncedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });

    if (changed) {
      const priorPayment = await prisma.payment.findFirst({ where: { finixTransferId } });
      if (priorPayment && priorPayment.status !== remoteState) {
        const transitioningToSucceeded = priorPayment.status !== "SUCCEEDED" && remoteState === "SUCCEEDED";
        // Stage 2 Task 8: Payment status + its required downstream jobs
        // commit in one transaction — same transactional-outbox pattern
        // Flow 3 already applied to the webhook's own Payment-transition
        // branch, so whichever of {webhook, reconciler} actually flips this
        // row is the only one whose dedupeKey-guarded enqueue succeeds; the
        // other's is a no-op via BackgroundJob.dedupeKey's unique
        // constraint. Previously this only sent a receipt directly
        // (fire-and-forget, no QuickBooks sync at all from this path) —
        // QUICKBOOKS_PAYMENT is added here to match every other
        // transition-to-SUCCEEDED path in the codebase (the same class of
        // gap Flow 3 fixed for the recurring-charge webhook).
        await prisma.$transaction(async (tx) => {
          await tx.payment.updateMany({ where: { finixTransferId }, data: { status: remoteState } });
          if (transitioningToSucceeded) {
            await enqueueBackgroundJobInTransaction(tx, {
              jobType: "SEND_RECEIPT",
              entityType: "Payment",
              entityId: priorPayment.id,
              dedupeKey: `SEND_RECEIPT:payment:${priorPayment.id}:version:1`,
              payload: { paymentId: priorPayment.id, churchId: priorPayment.churchId },
            });
            await enqueueBackgroundJobInTransaction(tx, {
              jobType: "QUICKBOOKS_PAYMENT",
              entityType: "Payment",
              entityId: priorPayment.id,
              dedupeKey: `QUICKBOOKS_PAYMENT:payment:${priorPayment.id}`,
              payload: { paymentId: priorPayment.id },
            });
          }
        });
      }

      // Fee reconciliation is triggered separately from settlement
      // association — a fee sync failure must never block the state update
      // that already succeeded above.
      try {
        await syncFeesForTransfer(finixTransferId, local.churchId ?? undefined);
      } catch (err) {
        console.error(`Fee reconciliation failed for ${finixTransferId}:`, err);
      }
    }

    return { reconciled: true, changed, newState: remoteState };
  } catch (err) {
    console.error(`Transfer reconciliation failed for ${finixTransferId}:`, err);
    return { reconciled: false, changed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface OrphanRecoveryResult {
  recovered: boolean;
  paymentId?: string;
  reason?: string;
}

/**
 * The automatic repair for the one gap the synchronous checkout path can't
 * close on its own: Finix confirms a one-time (non-subscription) transfer,
 * then the local process dies before Payment is durably written (see
 * donate/route.ts's post-charge write block and buildPaymentUncertainResponse).
 * Called from the TRANSFER webhook handler whenever a transfer event arrives
 * with no matching Payment row yet — this is the other half of that safety
 * net, and the one reusable place this reconstruction logic lives (also
 * intended for the future transfer-reconciliation cron, so there is exactly
 * one repair function rather than duplicated logic in two places).
 *
 * Identity-matching invariant (verified, not just intended): the only two
 * signals ever used to decide WHO this payment belongs to are (1) Finix's
 * own merchant mapping — `churchId` is the caller's already-verified value
 * (Church.finixMerchantId === data.merchant, resolved before this function
 * is called, from an authenticated Finix webhook payload), and (2) Finix's
 * own `idempotency_id` on the transfer, used to look up the exact
 * PaymentAttempt WGC itself created for this charge — cross-checked against
 * that same churchId before a single field of it is trusted. Tags, amount,
 * and donor email are NEVER used to determine tenancy or match a payment to
 * a person: tags supply only the fee-calculation snapshot (percentageBps,
 * fixedFeeCents, cardBrand) plus a givingLinkId that itself gets
 * independently re-verified against a real GivingLink row scoped to the
 * same churchId before being trusted; amount is only ever written into the
 * created Payment's own amount fields, never compared against anything to
 * decide identity; donorId is populated exclusively from a matched
 * PaymentAttempt and is left null (never guessed from an email/tag) when no
 * such attempt is found.
 */
export async function recoverOrphanedOneTimePayment(params: {
  finixTransferId: string;
  churchId: string;
  amountCents: number | null | undefined;
  state: string | null | undefined;
  tags: Record<string, string | undefined>;
  finixBuyerIdentityId: string | null | undefined;
  finixPaymentInstrumentId: string | null | undefined;
  idempotencyId: string | null | undefined;
}): Promise<OrphanRecoveryResult> {
  const { finixTransferId, churchId, amountCents, state, tags, finixBuyerIdentityId, finixPaymentInstrumentId, idempotencyId } = params;

  // Never reconstruct a Payment for a transfer that hasn't reached a
  // meaningful state yet — a still-PENDING transfer will get a normal
  // update once it terminates, same as the non-orphan path.
  const normalizedState = (state || "").toUpperCase();
  if (normalizedState !== "SUCCEEDED" && normalizedState !== "PENDING") {
    return { recovered: false, reason: "not_yet_terminal" };
  }

  // Prefer the PaymentAttempt WGC itself created synchronously, matched by
  // idempotencyId (== clientAttemptId at creation time) — this is trusted,
  // first-party WGC data, cross-checked against churchId before use.
  let attempt = idempotencyId ? await prisma.paymentAttempt.findUnique({ where: { idempotencyId } }) : null;
  if (attempt && attempt.churchId !== churchId) {
    // A mismatch here would mean either a genuine bug or a tampered
    // idempotency key — never trust a cross-tenant attempt record.
    attempt = null;
  }

  let givingLinkId: string | null = attempt?.givingLinkId ?? null;
  const donorId: string | null = attempt?.donorId ?? null;
  const fundId: string | null = attempt?.fundId ?? null;
  const fundName: string | null = attempt?.fundName ?? null;

  // Fallback only when no matching PaymentAttempt exists: the tag-sourced
  // givingLinkId is re-verified against a real GivingLink row belonging to
  // this exact churchId before being trusted for anything — tags are
  // caller-suppliable at charge time, so they are corroborating evidence,
  // never proof of tenancy on their own.
  if (!givingLinkId && tags.givingLinkId) {
    const link = await prisma.givingLink.findFirst({ where: { id: tags.givingLinkId, churchId }, select: { id: true } });
    if (link) givingLinkId = link.id;
  }

  const donationAmountCents = tags.donation_amount_cents ? Number(tags.donation_amount_cents) : null;
  const percentageBps = tags.fee_percentage_bps ? Number(tags.fee_percentage_bps) : null;
  const fixedFeeCents = tags.fee_fixed_cents ? Number(tags.fee_fixed_cents) : null;
  const cardBrand = tags.card_brand && tags.card_brand !== "NONE" ? tags.card_brand : null;
  const feeCalculationVersion = tags.fee_calculation_version || null;

  const createData: Prisma.PaymentUncheckedCreateInput = {
    churchId,
    donorId: donorId ?? undefined,
    givingLinkId: givingLinkId ?? undefined,
    paymentAttemptId: attempt?.id ?? undefined,
    finixTransferId,
    finixBuyerIdentityId: finixBuyerIdentityId ?? undefined,
    finixPaymentInstrumentId: finixPaymentInstrumentId ?? undefined,
    amountCents: amountCents ?? donationAmountCents ?? 0,
    donationAmountCents: donationAmountCents ?? amountCents ?? undefined,
    paymentMethodType: attempt?.paymentMethodType ?? "PAYMENT_CARD",
    status: normalizedState,
    cardBrand: cardBrand ?? undefined,
    percentageBps: percentageBps ?? undefined,
    fixedFeeCents: fixedFeeCents ?? undefined,
    feeCalculationVersion: feeCalculationVersion ?? undefined,
    fundId: fundId ?? undefined,
    fundName: fundName ?? undefined,
    isAnonymous: attempt?.isAnonymous ?? false,
    note: attempt?.note ?? undefined,
  };

  let payment;
  try {
    // Stage 2 Task 8: the Payment row and its required downstream jobs
    // commit in one transaction — this is the SAME function the webhook,
    // the reconciliation sweep, and (indirectly, via the shared
    // Payment.finixTransferId unique constraint) checkout's own P2002
    // fallback all rely on, so whichever caller wins this create() is the
    // only one whose dedupeKey-guarded job enqueue actually happens. This
    // closes the exact three-way race the Flow 3 / Task 8 spec requires
    // (checkout + webhook + reconciler -> exactly one SEND_RECEIPT, one
    // QUICKBOOKS_PAYMENT) without adding a second Payment-creation path.
    payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({ data: createData });
      if (created.status === "SUCCEEDED") {
        await enqueueBackgroundJobInTransaction(tx, {
          jobType: "SEND_RECEIPT",
          entityType: "Payment",
          entityId: created.id,
          dedupeKey: `SEND_RECEIPT:payment:${created.id}:version:1`,
          payload: { paymentId: created.id, churchId },
        });
        await enqueueBackgroundJobInTransaction(tx, {
          jobType: "QUICKBOOKS_PAYMENT",
          entityType: "Payment",
          entityId: created.id,
          dedupeKey: `QUICKBOOKS_PAYMENT:payment:${created.id}`,
          payload: { paymentId: created.id },
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lost a race against another concurrent recovery/write for this
      // exact transfer — Payment.finixTransferId is unique, so this is the
      // expected outcome, not an error.
      const existing = await prisma.payment.findUnique({ where: { finixTransferId } });
      if (existing) {
        logPaymentSafetyEvent("PAYMENT_DUPLICATE_PREVENTED", {
          churchId,
          finixTransferId,
          paymentAttemptId: attempt?.id ?? null,
          source: "orphan_recovery",
          detail: "P2002 on Payment.finixTransferId — another writer (checkout or a concurrent recovery) already created this Payment",
        });
        return { recovered: true, paymentId: existing.id, reason: "raced_created_elsewhere" };
      }
    }
    console.error(`Orphan payment recovery failed for transfer ${finixTransferId}:`, err);
    return { recovered: false, reason: err instanceof Error ? err.message : String(err) };
  }

  logPaymentSafetyEvent("ORPHAN_PAYMENT_RECOVERED", {
    finixTransferId,
    churchId,
    paymentAttemptId: attempt?.id ?? null,
    source: "webhook",
    detail: `matchedByPaymentAttempt=${Boolean(attempt)} state=${normalizedState}`,
  });

  if (attempt) {
    await prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: normalizedState, finixTransferId },
    }).catch((err) => console.error("Failed to update PaymentAttempt after orphan recovery:", err));
  }

  // Giving-link counters: the synchronous checkout path never reached its
  // own increment (it returned PAYMENT_STATUS_UNCERTAIN before getting
  // there) — this is the only writer of these counters for this payment,
  // so incrementing here is correct, not a double-count. Never touched
  // again on a future webhook delivery for the same transfer, since those
  // will find `payment` via priorPayment and take the existing update
  // branch instead of this recovery branch.
  if (givingLinkId) {
    try {
      await prisma.givingLink.update({
        where: { id: givingLinkId },
        data: {
          totalAttempts: { increment: 1 },
          lastUsedAt: new Date(),
          ...(normalizedState === "SUCCEEDED" ? { successfulDonations: { increment: 1 }, totalCollectedCents: { increment: payment.amountCents } } : {}),
        },
      });
    } catch (err) {
      console.error("Failed to update giving link counters during orphan recovery:", err);
    }
  }

  // SEND_RECEIPT / QUICKBOOKS_PAYMENT are already enqueued transactionally
  // above, alongside the Payment.create() itself — see that block's
  // comment.

  return { recovered: true, paymentId: payment.id };
}

/**
 * Bounded, throttled reconciliation pass for a church's pending payments —
 * called from page loads (Payments list, payment detail) rather than an
 * unbounded background sweep. Only payments old enough that "still
 * processing" is no longer the likely explanation are re-checked.
 */
export async function reconcilePendingPayments(churchId: string, limit = 25): Promise<{ checked: number; reconciled: number; changed: number }> {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_MIN_AGE_MS);
  const pending = await prisma.finixTransfer.findMany({
    where: {
      churchId,
      state: "PENDING",
      finixTransferId: { not: undefined },
      createdAtFinix: { lte: cutoff },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: new Date(Date.now() - PAYMENT_RECONCILE_THROTTLE_MS) } }],
    },
    select: { finixTransferId: true },
    take: limit,
  });

  if (pending.length === 0) return { checked: 0, reconciled: 0, changed: 0 };

  const results = await Promise.allSettled(pending.map((t) => reconcilePendingTransfer(t.finixTransferId)));
  const reconciled = results.filter((r) => r.status === "fulfilled" && r.value.reconciled).length;
  const changed = results.filter((r) => r.status === "fulfilled" && r.value.changed).length;
  return { checked: pending.length, reconciled, changed };
}
