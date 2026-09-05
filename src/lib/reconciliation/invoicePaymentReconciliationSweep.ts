import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { applyInvoicePaymentTransferState, reconcileInvoicePaymentAttempt } from "@/lib/invoices/invoicePaymentReconciliation";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { emptyOutcomeCounts, type SweepSummary } from "./outcomes";

/**
 * The only Finix client method this file ever calls is the read-only
 * `getTransfer` — no `createTransfer`-shaped import exists here, so this
 * sweep is structurally incapable of initiating a new charge no matter
 * what future edits add.
 */

/**
 * Stage 2 Task 8 — bounded, scheduled orchestration of Stage 1's existing
 * invoice-payment recovery primitives. Same governing rule as
 * paymentReconciliationSweep.ts: this file creates no new financial
 * mutation. It only decides WHICH stale InvoicePaymentAttempts to feed
 * into `reconcileInvoicePaymentAttempt` (which itself calls
 * `applyInvoicePaymentTransferState`, the single existing choke point
 * shared with the webhook handler) — never creates a second Finix
 * transfer, and imports no transfer-creation function at all.
 */

const STALE_ATTEMPT_AFTER_MS = 15 * 60 * 1000;

/**
 * Read-only — bounded scan of InvoicePaymentAttempts still PENDING/
 * PROCESSING past a staleness threshold, using the [status, updatedAt]
 * index added this task (mirrors findStaleRefundRequests's exact shape).
 */
export async function findStaleInvoicePaymentAttempts(staleAfterMs: number = STALE_ATTEMPT_AFTER_MS, limit = 50) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  return prisma.invoicePaymentAttempt.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] }, updatedAt: { lt: cutoff } },
    select: { id: true, clientAttemptId: true, churchId: true, invoiceId: true, updatedAt: true, finixTransferId: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}

export async function reconcileStaleInvoicePaymentAttempts(limit = 50): Promise<SweepSummary> {
  const outcomes = emptyOutcomeCounts();
  const candidates = await findStaleInvoicePaymentAttempts(STALE_ATTEMPT_AFTER_MS, limit);

  if (candidates.length === 0) return { candidatesChecked: 0, outcomes };

  logPaymentSafetyEvent("INVOICE_RECONCILIATION_STARTED", { source: "reconciliation", detail: `stale-invoice-attempt sweep, candidates=${candidates.length}` });

  for (const attempt of candidates) {
    try {
      if (!attempt.finixTransferId) {
        // No transfer was ever created for this attempt (died before the
        // Finix call, or the payer never completed the wallet flow) —
        // there is genuinely nothing at Finix to discover. Read-only
        // idempotency-id lookup (never a create) is the only further
        // check available, matching the Payment-side sweep's own
        // "findTransferByIdempotencyId, else leave/abandon" shape — but
        // InvoicePaymentAttempt doesn't carry a standalone idempotencyId
        // Finix search key the way PaymentAttempt does (it's the
        // attempt's own key, not guaranteed to be what Finix echoes back
        // if the call never reached Finix), so this is left STILL_UNCERTAIN
        // for a human/admin view rather than guessed at.
        outcomes.STILL_UNCERTAIN++;
        continue;
      }

      const before = attempt;
      const existingInvoicePayment = await prisma.invoicePayment.findFirst({ where: { finixTransferId: before.finixTransferId! } });

      if (!existingInvoicePayment) {
        // The orphan case (Task 8 item 4/12): a Finix transfer exists but
        // WGC's local InvoicePayment write never landed. The payer-return
        // path, reconcileInvoicePaymentAttempt, does NOT cover this — it
        // never passes an orphanContext to applyInvoicePaymentTransferState
        // (it only exists to re-verify an attempt that already has a
        // matching InvoicePayment). So this sweep calls the read-only
        // Finix lookup itself, then goes straight to
        // applyInvoicePaymentTransferState WITH the orphanContext built
        // from this attempt's own trusted, first-party fields — the exact
        // repair path the webhook uses for the identical gap, never a
        // second Finix transfer.
        const remote = await finixClient.getTransfer(before.finixTransferId!);
        const remoteState = (remote?.state || "PENDING").toUpperCase();

        if (remoteState !== "SUCCEEDED" && remoteState !== "PENDING") {
          // Terminal-failed at Finix with nothing local to show for it —
          // leave for a human; not a "recovery," just a fact worth
          // surfacing rather than repeatedly rechecking.
          outcomes.NOT_FOUND++;
          continue;
        }
        if (remoteState === "PENDING") {
          outcomes.STILL_UNCERTAIN++;
          continue;
        }

        const attemptRow = await prisma.invoicePaymentAttempt.findUnique({ where: { id: before.id } });
        await applyInvoicePaymentTransferState(before.finixTransferId!, remote.state, {
          churchId: before.churchId,
          amountCents: attemptRow?.amountCents ?? null,
          idempotencyId: attemptRow?.idempotencyKey ?? null,
          finixMethod: attemptRow?.method ?? "CARD",
        });

        const recoveredPayment = await prisma.invoicePayment.findFirst({ where: { finixTransferId: before.finixTransferId! } });
        if (recoveredPayment) {
          outcomes.RECOVERED++;
          logPaymentSafetyEvent("INVOICE_RECONCILIATION_RECOVERED", {
            churchId: before.churchId,
            finixTransferId: before.finixTransferId,
            source: "reconciliation",
            detail: `invoiceId=${before.invoiceId} invoicePaymentAttemptId=${before.id} status=${remoteState}`,
          });
        } else {
          // recoverOrphanedInvoicePayment couldn't match a trusted
          // InvoicePaymentAttempt (or lost a P2002 race with no existing
          // row found) — surfaced, never guessed at further.
          outcomes.PERMANENT_ERROR++;
          logPaymentSafetyEvent("INVOICE_RECONCILIATION_UNRESOLVED", { churchId: before.churchId, finixTransferId: before.finixTransferId, source: "reconciliation", detail: `invoicePaymentAttemptId=${before.id} orphan recovery did not produce an InvoicePayment` });
        }
        continue;
      }

      // An InvoicePayment already exists for this transfer — this is the
      // ordinary "attempt status just never got updated locally" case
      // reconcileInvoicePaymentAttempt is actually designed for.
      const result = await reconcileInvoicePaymentAttempt(attempt.clientAttemptId);
      if (!result || !result.attempt) {
        outcomes.NOT_FOUND++;
        continue;
      }
      if (result.attempt.status === "SUCCEEDED" || result.attempt.status === "FAILED") {
        outcomes.ALREADY_RESOLVED++;
      } else {
        outcomes.STILL_UNCERTAIN++;
        logPaymentSafetyEvent("INVOICE_RECONCILIATION_UNRESOLVED", { churchId: before.churchId, finixTransferId: before.finixTransferId, source: "reconciliation", detail: `invoicePaymentAttemptId=${before.id} still ${result.attempt.status}` });
      }
    } catch (err) {
      outcomes.RETRYABLE_ERROR++;
      console.error(`Invoice payment reconciliation sweep failed for attempt ${attempt.id}:`, err);
    }
  }

  return { candidatesChecked: candidates.length, outcomes };
}
