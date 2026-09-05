import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { calculateInvoiceBalance } from "./invoiceMoney";
import { computeDerivedInvoiceStatus, type InvoiceStatus } from "./invoiceStatus";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { enqueueBackgroundJobInTransaction } from "@/lib/jobs/backgroundJobs";

/**
 * Applies a Finix transfer's current state onto its matching InvoicePayment
 * and recomputes the invoice balance/status — the single place this
 * happens, shared by the webhook handler (src/app/api/webhooks/finix/route.ts)
 * and reconcileInvoicePaymentAttempt below (used when a payer returns from
 * a wallet flow and the webhook hasn't arrived yet). Whichever caller gets
 * there first wins; the other's update becomes a no-op once
 * InvoicePayment.status already matches, so a webhook arriving at the same
 * moment as a return-page verification can never double-apply a payment or
 * create a duplicate InvoiceActivity/receipt email.
 */
export async function applyInvoicePaymentTransferState(
  finixTransferId: string,
  rawState: string | null | undefined,
  // Orphan-recovery inputs — all optional so every existing caller
  // (payer-return reconciliation, which only ever re-checks a transfer WGC
  // already has an InvoicePaymentAttempt/InvoicePayment for) keeps working
  // unchanged. Only the webhook handler passes these, and only churchId is
  // trusted for tenant assignment — it must already be merchant-mapping-
  // verified (Church.finixMerchantId === the transfer's own merchant) by
  // the caller, never taken from the transfer's tags directly.
  orphanContext?: { churchId: string; amountCents: number | null; idempotencyId: string | null; finixMethod: string }
): Promise<{ status: string; applied: boolean }> {
  const priorInvoicePayment = await prisma.invoicePayment.findFirst({ where: { finixTransferId } });
  const newState = (rawState || "PENDING").toUpperCase();
  const newStatus = newState === "SUCCEEDED" ? "SUCCEEDED" : newState === "FAILED" || newState === "CANCELED" ? "FAILED" : "PENDING";

  if (!priorInvoicePayment) {
    if (orphanContext && (newStatus === "SUCCEEDED" || newStatus === "PENDING")) {
      await recoverOrphanedInvoicePayment(finixTransferId, newStatus, orphanContext);
    }
    return { status: newStatus, applied: false };
  }
  if (priorInvoicePayment.status === newStatus) return { status: newStatus, applied: false };

  // Out-of-order protection: a terminal state already recorded must never
  // be regressed by a stale PENDING re-check.
  const TERMINAL = new Set(["SUCCEEDED", "FAILED"]);
  if (TERMINAL.has(priorInvoicePayment.status) && !TERMINAL.has(newStatus)) {
    return { status: priorInvoicePayment.status, applied: false };
  }

  await prisma.invoicePayment.update({ where: { id: priorInvoicePayment.id }, data: { status: newStatus } });

  const invoice = await prisma.invoice.findUnique({ where: { id: priorInvoicePayment.invoiceId } });
  if (invoice) {
    const payments = await prisma.invoicePayment.findMany({
      where: { invoiceId: invoice.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    });
    const balance = calculateInvoiceBalance({ totalCents: invoice.totalCents, payments });
    const derivedStatus = computeDerivedInvoiceStatus({
      currentStatus: invoice.status as InvoiceStatus,
      balanceCents: balance.balanceCents,
      totalCents: invoice.totalCents,
      hasBeenViewed: Boolean(invoice.firstViewedAt),
      dueDate: invoice.dueDate,
    });
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaidCents: balance.amountPaidCents,
        balanceCents: balance.balanceCents,
        status: derivedStatus,
        paidAt: derivedStatus === "PAID" && !invoice.paidAt ? new Date() : invoice.paidAt,
      },
    });
    await prisma.invoiceActivity.create({
      data: {
        invoiceId: invoice.id,
        churchId: invoice.churchId,
        activityType: newStatus === "SUCCEEDED" ? "invoice.payment_settled" : "invoice.payment_failed",
        metadata: { finixTransferId, previousStatus: priorInvoicePayment.status, newStatus },
      },
    });

    // Invoice-feature usage ledger — trusted server-side only (this
    // function is the single choke point both the Finix webhook and the
    // payer-return reconciliation path go through; never driven by a raw
    // browser signal). Idempotent per finixTransferId + resulting status,
    // so a duplicate webhook, a page refresh, or a reconciliation retry
    // can never double-count.
    if (derivedStatus === "PAID" || derivedStatus === "PARTIALLY_PAID") {
      try {
        const { recordInvoiceUsageEvent } = await import("@/lib/billing/invoiceUsageLedger");
        await recordInvoiceUsageEvent({
          organizationId: invoice.churchId,
          invoiceId: invoice.id,
          invoicePaymentId: priorInvoicePayment.id,
          eventType: derivedStatus === "PAID" ? "INVOICE_PAID" : "INVOICE_PARTIALLY_PAID",
          invoiceAmountCents: invoice.totalCents,
          amountPaidCents: balance.amountPaidCents,
          idempotencyKey: `${finixTransferId}:${derivedStatus}`,
        });
      } catch (err) {
        console.error("Invoice usage ledger recording failed (non-fatal):", err);
      }
    }

    if (newStatus === "SUCCEEDED" && priorInvoicePayment.method === "ACH") {
      try {
        const { sendInvoicePaymentReceiptEmail } = await import("./invoiceEmails");
        await sendInvoicePaymentReceiptEmail(invoice.id, priorInvoicePayment.id);
      } catch (err) {
        console.error("Failed to send invoice ACH settlement receipt email:", err);
      }
    }
  }

  return { status: newStatus, applied: true };
}

/**
 * The InvoicePayment equivalent of paymentReconciliation.ts's
 * recoverOrphanedOneTimePayment — same gap, same fix: the synchronous
 * /api/invoice/[token]/pay path can crash after Finix confirms a transfer
 * but before InvoicePayment is durably written (see that route's own
 * PAYMENT_STATUS_UNCERTAIN handling). This reconstructs it from trusted
 * WGC data once the webhook arrives, matched by idempotencyKey (Finix's
 * own idempotency_id, echoed back on the transfer) against
 * InvoicePaymentAttempt — never by amount or timing. churchId is the
 * caller's already merchant-mapping-verified value; a matched attempt is
 * cross-checked against it before a single field is trusted, same
 * invariant as the one-time-donation orphan recovery.
 */
async function recoverOrphanedInvoicePayment(
  finixTransferId: string,
  status: "SUCCEEDED" | "PENDING",
  ctx: { churchId: string; amountCents: number | null; idempotencyId: string | null; finixMethod: string }
): Promise<void> {
  let attempt = ctx.idempotencyId ? await prisma.invoicePaymentAttempt.findUnique({ where: { idempotencyKey: ctx.idempotencyId } }) : null;
  if (attempt && attempt.churchId !== ctx.churchId) {
    // Mismatch = either a bug or a tampered key — never trust a
    // cross-tenant attempt record.
    attempt = null;
  }
  if (!attempt) {
    // No trusted WGC record to reconstruct from — nothing more this
    // function can safely do without guessing at invoiceId/tenant, which
    // is exactly what it must never do. Left for human reconciliation
    // (the same "ORPHANED_CHARGE" alert pattern the main reconcile cron
    // uses for Payment).
    console.error(`Orphan InvoicePayment recovery: no matching InvoicePaymentAttempt for transfer ${finixTransferId} (idempotencyId=${ctx.idempotencyId ?? "none"}) — needs manual review.`);
    return;
  }

  const grossAmountCents = ctx.amountCents ?? attempt.amountCents;
  let invoicePayment;
  try {
    // Stage 2 Task 8: the InvoicePayment row and its required
    // INVOICE_RECEIPT job commit in one transaction — previously this
    // orphan path never sent a receipt for a recovered invoice payment at
    // all (the normal, non-orphan path in applyInvoicePaymentTransferState
    // only sends one for ACH, and even then only via a direct,
    // non-durable call). Using the existing INVOICE_RECEIPT job here
    // (already wired in jobHandlers.ts since Flow 5) closes that gap for
    // every payment method a reconciler recovers, not just ACH, and makes
    // it dedupeKey-safe against a concurrent normal-path delivery for the
    // same transfer.
    invoicePayment = await prisma.$transaction(async (tx) => {
      const created = await tx.invoicePayment.create({
        data: {
          invoiceId: attempt.invoiceId,
          churchId: ctx.churchId,
          source: "FINIX",
          method: attempt.method || ctx.finixMethod,
          grossAmountCents,
          netAmountCents: grossAmountCents,
          totalChargedCents: ctx.amountCents ?? attempt.amountCents,
          status,
          finixTransferId,
          invoicePaymentAttemptId: attempt.id,
        },
      });
      if (status === "SUCCEEDED") {
        await enqueueBackgroundJobInTransaction(tx, {
          jobType: "INVOICE_RECEIPT",
          entityType: "InvoicePayment",
          entityId: created.id,
          dedupeKey: `INVOICE_RECEIPT:invoicePayment:${created.id}`,
          payload: { invoiceId: attempt.invoiceId, invoicePaymentId: created.id },
        });
      }
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.invoicePayment.findUnique({ where: { finixTransferId } });
      if (existing) {
        logPaymentSafetyEvent("PAYMENT_DUPLICATE_PREVENTED", { churchId: ctx.churchId, finixTransferId, source: "orphan_recovery", detail: "P2002 on InvoicePayment.finixTransferId — already recovered elsewhere" });
        return;
      }
    }
    console.error(`Orphan InvoicePayment recovery failed for transfer ${finixTransferId}:`, err);
    return;
  }

  logPaymentSafetyEvent("ORPHAN_PAYMENT_RECOVERED", {
    churchId: ctx.churchId,
    finixTransferId,
    source: "webhook",
    detail: `InvoicePayment ${invoicePayment.id} reconstructed for invoice ${attempt.invoiceId}, status=${status}`,
  });

  await prisma.invoicePaymentAttempt.update({ where: { id: attempt.id }, data: { status, finixTransferId } }).catch((err) => console.error("Failed to update InvoicePaymentAttempt after orphan recovery:", err));

  if (status !== "SUCCEEDED") return;

  // Same balance/status recompute the normal path already applies below —
  // duplicated narrowly here rather than recursing back into
  // applyInvoicePaymentTransferState (which would re-run the `!priorInvoicePayment`
  // branch again now that one exists, adding an unnecessary extra query
  // round-trip but no correctness risk either way — kept separate for
  // clarity about exactly what orphan recovery itself is responsible for).
  const invoice = await prisma.invoice.findUnique({ where: { id: attempt.invoiceId } });
  if (!invoice) return;
  const payments = await prisma.invoicePayment.findMany({ where: { invoiceId: invoice.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } } });
  const balance = calculateInvoiceBalance({ totalCents: invoice.totalCents, payments });
  const derivedStatus = computeDerivedInvoiceStatus({
    currentStatus: invoice.status as InvoiceStatus,
    balanceCents: balance.balanceCents,
    totalCents: invoice.totalCents,
    hasBeenViewed: Boolean(invoice.firstViewedAt),
    dueDate: invoice.dueDate,
  });
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { amountPaidCents: balance.amountPaidCents, balanceCents: balance.balanceCents, status: derivedStatus, paidAt: derivedStatus === "PAID" && !invoice.paidAt ? new Date() : invoice.paidAt },
  });
  await prisma.invoiceActivity.create({
    data: { invoiceId: invoice.id, churchId: invoice.churchId, activityType: "invoice.payment_settled", metadata: { finixTransferId, recoveredFromOrphan: true } },
  });
}

/**
 * Called from the public payment-status endpoint when a payer returns to
 * the invoice page (e.g. after a wallet flow) — verifies the real payment
 * state directly against Finix rather than trusting any client-side or URL
 * signal, per "reconcile the invoice when the customer returns, even if
 * the webhook has not arrived yet." A no-op (just returns current state)
 * once the attempt has already reached a terminal state.
 */
export async function reconcileInvoicePaymentAttempt(clientAttemptId: string) {
  const attempt = await prisma.invoicePaymentAttempt.findUnique({ where: { clientAttemptId } });
  if (!attempt) return null;

  if ((attempt.status === "PROCESSING" || attempt.status === "PENDING") && attempt.finixTransferId) {
    try {
      const remote = await finixClient.getTransfer(attempt.finixTransferId);
      const remoteState = (remote.state || "PENDING").toUpperCase();
      const attemptStatus = remoteState === "SUCCEEDED" ? "SUCCEEDED" : remoteState === "FAILED" || remoteState === "CANCELED" ? "FAILED" : "PENDING";
      if (attemptStatus !== attempt.status) {
        await prisma.invoicePaymentAttempt.update({ where: { id: attempt.id }, data: { status: attemptStatus } });
      }
      await applyInvoicePaymentTransferState(attempt.finixTransferId, remote.state);
    } catch (err) {
      console.error("Failed to reconcile invoice payment attempt against Finix:", err);
    }
  }

  const [refreshedAttempt, payment] = await Promise.all([
    prisma.invoicePaymentAttempt.findUnique({ where: { id: attempt.id } }),
    attempt.finixTransferId ? prisma.invoicePayment.findFirst({ where: { finixTransferId: attempt.finixTransferId } }) : null,
  ]);

  return { attempt: refreshedAttempt, payment };
}
