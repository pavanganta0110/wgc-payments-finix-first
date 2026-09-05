import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { reconcilePendingTransfer, recoverOrphanedOneTimePayment, PENDING_PAYMENT_MIN_AGE_MS, PAYMENT_RECONCILE_THROTTLE_MS } from "@/lib/finix/sync/paymentReconciliation";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { emptyOutcomeCounts, type ReconciliationOutcome, type SweepSummary } from "./outcomes";

/**
 * Stage 2 Task 8 — bounded, scheduled orchestration of Stage 1's existing
 * recovery primitives for one-time Payments. This module creates NO new
 * financial-mutation logic: every repair below is delegated to
 * `reconcilePendingTransfer` / `recoverOrphanedOneTimePayment`
 * (src/lib/finix/sync/paymentReconciliation.ts), which already existed in
 * Stage 1 and are also the exact functions the webhook handler calls. This
 * file only adds the missing piece: a bounded, global, indexed scan that
 * decides WHICH candidates to feed them, on a schedule, instead of only on
 * a page load (reconcilePendingTransfer) or only from an inline webhook
 * branch (recoverOrphanedOneTimePayment).
 *
 * GOVERNING RULE: this sweep may discover and repair state. It may NEVER
 * create a new Finix charge — grep this file: it imports no
 * `createTransfer`-shaped function from `finixClient`, only read-only
 * lookups (`getTransfer`, `findTransferByIdempotencyId`). Structurally
 * incapable of initiating a new charge.
 */

const STALE_ATTEMPT_AFTER_MS = 15 * 60 * 1000; // matches the prior cron/reconcile inline sweep
const ABANDONED_ATTEMPT_AFTER_MS = 60 * 60 * 1000;

function classifyTransferOutcome(result: { reconciled: boolean; changed: boolean; error?: string }): ReconciliationOutcome {
  if (!result.reconciled) {
    if (result.error === "Transfer not found locally") return "NOT_FOUND";
    return "RETRYABLE_ERROR";
  }
  return result.changed ? "RECOVERED" : "ALREADY_RESOLVED";
}

/**
 * Bounded global scan of stuck-PENDING FinixTransfers (not scoped to one
 * church, unlike the page-load version of this same idea,
 * `reconcilePendingPayments`) — indexed on [status, lastReconciledAt] via
 * FinixTransfer's existing `state`/`lastReconciledAt` columns, ordered
 * deterministically, capped at `limit` so this is safe whether there are
 * 10 or 100,000 unresolved rows (not yet performance-PROVEN at 100,000 —
 * see Task 8 checkpoint).
 */
export async function reconcileStaleTransfers(limit = 50): Promise<SweepSummary> {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_MIN_AGE_MS);
  const throttleCutoff = new Date(Date.now() - PAYMENT_RECONCILE_THROTTLE_MS);
  const outcomes = emptyOutcomeCounts();

  const candidates = await prisma.finixTransfer.findMany({
    where: {
      state: "PENDING",
      createdAtFinix: { lte: cutoff },
      OR: [{ lastReconciledAt: null }, { lastReconciledAt: { lt: throttleCutoff } }],
    },
    select: { finixTransferId: true },
    orderBy: { createdAtFinix: "asc" },
    take: limit,
  });

  if (candidates.length === 0) return { candidatesChecked: 0, outcomes };

  logPaymentSafetyEvent("PAYMENT_RECONCILIATION_STARTED", { source: "reconciliation", detail: `stale-transfer sweep, candidates=${candidates.length}` });

  // Sequential, not Promise.all — each call already does its own Finix
  // HTTP round-trip + short DB writes; running the whole batch
  // concurrently would fan out that many simultaneous Finix calls per
  // sweep tick, which is unbounded concurrency this worker explicitly
  // must avoid (Task 8, "limited concurrency").
  for (const { finixTransferId } of candidates) {
    if (!finixTransferId) continue;
    try {
      const result = await reconcilePendingTransfer(finixTransferId);
      const outcome = classifyTransferOutcome(result);
      outcomes[outcome]++;
      if (outcome === "RECOVERED") {
        logPaymentSafetyEvent("PAYMENT_RECONCILIATION_RECOVERED", { finixTransferId, source: "reconciliation", detail: `newState=${result.newState}` });
      } else if (outcome === "STILL_UNCERTAIN" || outcome === "RETRYABLE_ERROR") {
        logPaymentSafetyEvent("PAYMENT_RECONCILIATION_UNRESOLVED", { finixTransferId, source: "reconciliation", detail: result.error ?? "no change" });
      }
    } catch (err) {
      outcomes.PERMANENT_ERROR++;
      console.error(`Payment reconciliation sweep: unexpected error for transfer ${finixTransferId}:`, err);
      logPaymentSafetyEvent("PAYMENT_RECONCILIATION_UNRESOLVED", { finixTransferId, source: "reconciliation", detail: err instanceof Error ? err.message.slice(0, 300) : String(err) });
    }
  }

  return { candidatesChecked: candidates.length, outcomes };
}

/**
 * Bounded scan of stuck PaymentAttempts (status PROCESSING, unchanged for
 * 15+ minutes) — the "Finix-confirmed/local-Payment-missing" and
 * "local write failure after Finix success" scenarios named in the Task 8
 * objective. This REPLACES the inline sweep previously duplicated inside
 * src/app/api/cron/reconcile/route.ts, which only ever emailed a human;
 * now that Stage 2's dedupeKey/unique-constraint protections exist, the
 * safe repair (recoverOrphanedOneTimePayment) can run automatically —
 * exactly the "orchestrate existing safe Stage 1 recovery" instruction —
 * while still alerting a human on a genuine, unexpected failure.
 *
 * Uses PaymentAttempt's [status, updatedAt] index (added this task).
 */
export async function reconcileStalePaymentAttempts(limit = 100): Promise<SweepSummary & { abandonedClosed: number }> {
  const cutoff = new Date(Date.now() - STALE_ATTEMPT_AFTER_MS);
  const outcomes = emptyOutcomeCounts();
  let abandonedClosed = 0;

  const STUCK_ALERT_MARKER = "ORPHANED_CHARGE_ALERTED";
  const candidates = await prisma.paymentAttempt.findMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lte: cutoff },
      NOT: { failureMessage: { startsWith: STUCK_ALERT_MARKER } },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  if (candidates.length === 0) return { candidatesChecked: 0, outcomes, abandonedClosed };

  logPaymentSafetyEvent("PAYMENT_RECONCILIATION_STARTED", { source: "reconciliation", detail: `stale-payment-attempt sweep, candidates=${candidates.length}` });

  for (const attempt of candidates) {
    try {
      // Read-only Finix lookup happens OUTSIDE any DB transaction — the
      // repair itself (recoverOrphanedOneTimePayment) opens its own short
      // transaction only after this HTTP round-trip completes.
      const transfer = await finixClient.findTransferByIdempotencyId(attempt.idempotencyId);

      if (transfer) {
        const existingPayment = await prisma.payment.findFirst({ where: { finixTransferId: transfer.id } });
        if (existingPayment) {
          // Someone else (webhook, or a concurrent sweep) already
          // recovered this — just close the attempt out.
          await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: existingPayment.status, finixTransferId: transfer.id } }).catch(() => {});
          outcomes.ALREADY_RESOLVED++;
          continue;
        }

        const recovery = await recoverOrphanedOneTimePayment({
          finixTransferId: transfer.id,
          churchId: attempt.churchId,
          amountCents: transfer.amount ?? attempt.totalCents,
          state: transfer.state,
          tags: (transfer.tags as Record<string, string | undefined>) ?? {},
          finixBuyerIdentityId: transfer.merchant_identity ?? null,
          finixPaymentInstrumentId: transfer.source ?? null,
          idempotencyId: attempt.idempotencyId,
        });

        if (recovery.recovered) {
          outcomes.RECOVERED++;
          logPaymentSafetyEvent("PAYMENT_RECONCILIATION_RECOVERED", {
            churchId: attempt.churchId,
            paymentAttemptId: attempt.id,
            finixTransferId: transfer.id,
            source: "reconciliation",
            detail: `paymentId=${recovery.paymentId} reason=${recovery.reason ?? "matched_payment_attempt"}`,
          });
        } else if (recovery.reason === "not_yet_terminal") {
          outcomes.STILL_UNCERTAIN++;
        } else {
          // recoverOrphanedOneTimePayment failed for a reason that isn't a
          // benign race (a real DB error) — this is exactly the kind of
          // gap the old inline sweep alerted a human for. Escalate the
          // same way rather than silently retrying forever.
          outcomes.PERMANENT_ERROR++;
          logPaymentSafetyEvent("PAYMENT_RECONCILIATION_UNRESOLVED", { churchId: attempt.churchId, paymentAttemptId: attempt.id, finixTransferId: transfer.id, source: "reconciliation", detail: recovery.reason });
          const church = await prisma.church.findUnique({ where: { id: attempt.churchId } });
          const { sendWgcAdminEmail } = await import("@/lib/email");
          await sendWgcAdminEmail({
            merchantName: church?.name || attempt.churchId,
            contactEmail: church?.primaryContactEmail || "unknown",
            finixMerchantId: church?.finixMerchantId || undefined,
            newStatus: "ORPHANED_CHARGE",
            whatHappened: `A Finix transfer (${transfer.id}, state ${transfer.state}) succeeded but automatic reconciliation could not repair PaymentAttempt ${attempt.id}: ${recovery.reason}`,
            actionNeeded: "Manually verify the Finix transfer and create the corresponding Payment/receipt record, or refund the transfer if it should not have succeeded.",
            adminDashboardLink: `${process.env.NEXT_PUBLIC_APP_URL || "https://www.wgcpayments.com"}/admin/merchants`,
            customSubject: `[Action Needed] Orphaned Finix charge for ${church?.name || attempt.churchId}`,
          });
          await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { failureMessage: `${STUCK_ALERT_MARKER}: transfer ${transfer.id} could not be auto-recovered (${recovery.reason})` } });
        }
      } else if (attempt.updatedAt.getTime() < Date.now() - ABANDONED_ATTEMPT_AFTER_MS) {
        // No Finix transfer ever showed up for this attempt after an hour
        // — the donor abandoned checkout before a charge was made. Never
        // touches Finix or money; just stops it from looking "stuck."
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: "FAILED", failureMessage: "Abandoned — no matching Finix transfer found after 1 hour" },
        });
        abandonedClosed++;
        outcomes.NOT_FOUND++;
      } else {
        outcomes.STILL_UNCERTAIN++;
      }
    } catch (err) {
      outcomes.RETRYABLE_ERROR++;
      console.error(`Payment reconciliation sweep: stuck-attempt check failed for PaymentAttempt ${attempt.id}:`, err);
    }
  }

  return { candidatesChecked: candidates.length, outcomes, abandonedClosed };
}
