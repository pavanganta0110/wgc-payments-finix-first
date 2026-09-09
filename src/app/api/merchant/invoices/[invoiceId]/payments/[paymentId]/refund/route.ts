import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { redactFinixPayload } from "@/lib/finix/redact";
import { toSafeErrorResponse } from "@/lib/utils/errorNormalizer";
import { logDashboardAction } from "@/lib/dashboardAudit";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { requirePermission } from "@/lib/auth/permissions";
import { isAuthError, ForbiddenError } from "@/lib/auth/errors";
import { calculateInvoiceBalance } from "@/lib/invoices/invoiceMoney";
import { computeDerivedInvoiceStatus, type InvoiceStatus } from "@/lib/invoices/invoiceStatus";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { claimRefundRequestWithBalanceLock, RefundNotFoundError, RefundIneligibleError, RefundAmountError } from "@/lib/payments/refundRequestClaim";

/**
 * Refunds a single InvoicePayment — for a FINIX-sourced payment this calls
 * Finix's own reversal API (the existing refund system used elsewhere in
 * this app, see /transactions/payments/[transferId]/refund/route.ts —
 * reused here rather than duplicated). For an OFFLINE-sourced payment
 * there is no processor to call; this is purely a bookkeeping adjustment
 * the merchant is asserting is true (they returned cash, voided a check,
 * etc.), recorded the same way.
 *
 * Either way, only refundedCents/status on the InvoicePayment are ever
 * touched — never grossAmountCents/netAmountCents — and the invoice
 * balance/status is always recomputed from the full payments ledger, never
 * decremented in place.
 */
export async function POST(req: Request, { params }: { params: Promise<{ invoiceId: string; paymentId: string }> }) {
  let auth;
  try {
    auth = await requireMerchantSession();
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  try {
    requirePermission(auth, "canRefundInvoicePayments");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { invoiceId, paymentId } = await params;
  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, churchId: auth.churchId } });
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
  }
  const payment = await prisma.invoicePayment.findFirst({ where: { id: paymentId, invoiceId, churchId: auth.churchId } });
  if (!payment) {
    return NextResponse.json({ error: "Payment not found." }, { status: 404 });
  }
  if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") {
    return NextResponse.json({ error: "This payment is not eligible for a refund." }, { status: 400 });
  }

  const refundableCents = payment.grossAmountCents - payment.refundedCents;
  const body = await req.json().catch(() => ({}));
  const requestedCents = typeof body?.amountCents === "number" ? Math.round(body.amountCents) : refundableCents;
  if (requestedCents <= 0 || requestedCents > refundableCents) {
    return NextResponse.json({ error: "The refund amount cannot exceed the remaining refundable balance." }, { status: 400 });
  }

  if (payment.source === "FINIX") {
    if (!payment.finixTransferId) {
      return toSafeErrorResponse("This payment could not be matched to a processor transfer.", 400);
    }

    // Same ONE-REFUND-INTENT -> AT-MOST-ONE-REVERSAL guarantee as
    // /transactions/payments/[transferId]/refund/route.ts — both routes
    // now call the exact same claimRefundRequestWithBalanceLock() (see
    // that module's doc comment). This closes the concurrency gap the
    // earlier version of this route had: refundableCents was previously
    // read with a plain, unlocked query and never accounted for another
    // PENDING RefundRequest against the same transfer, so two concurrent
    // partial refunds could together exceed the real refundable balance
    // (cold-review defect #3). The shared function re-derives the
    // authoritative remaining balance from FinixTransfer under a row lock,
    // which is the same transfer this InvoicePayment's finixTransferId
    // points at, so it also can't be over-refunded by an overlapping claim
    // made through the OTHER refund route. clientRefundId falls back to a
    // value derived from (payment, amount) when the caller doesn't supply
    // one, so an accidental repeat of the identical request collapses to
    // the same claim, while a genuinely different amount (a real second
    // partial refund) is correctly treated as new.
    const clientRefundId =
      typeof body.clientRefundId === "string" && body.clientRefundId.trim() ? body.clientRefundId.trim() : `invoice-payment:${payment.id}:${requestedCents}`;

    let claim;
    try {
      claim = await claimRefundRequestWithBalanceLock({
        finixTransferId: payment.finixTransferId!,
        churchId: auth.churchId,
        clientRefundId,
        requestedAmountCents: requestedCents,
        requestedByUserId: auth.userId,
        requestedByEmail: auth.email,
        reason: "Invoice payment refund",
        originalPaymentId: null,
      });
    } catch (err) {
      if (err instanceof RefundNotFoundError) return toSafeErrorResponse(err.message, 404);
      if (err instanceof RefundIneligibleError) return toSafeErrorResponse(err.message, 400);
      if (err instanceof RefundAmountError) return toSafeErrorResponse(err.message, 400);
      return toSafeErrorResponse(err, 502, { action: "refundInvoicePayment", resourceId: payment.id });
    }

    if (!claim.isFreshClaim) {
      if (claim.refundRequest.status === "SUCCEEDED" && claim.refundRequest.finixReversalId) {
        logPaymentSafetyEvent("REFUND_DUPLICATE_PREVENTED", {
          churchId: auth.churchId,
          finixTransferId: payment.finixTransferId,
          refundRequestId: claim.refundRequest.id,
          finixReversalId: claim.refundRequest.finixReversalId,
          source: "checkout",
          route: `/api/merchant/invoices/${invoiceId}/payments/${paymentId}/refund`,
          detail: "P2002 on RefundRequest[finixTransferId,clientRefundId] — replayed the already-completed reversal instead of calling Finix again",
        });
        return NextResponse.json({ success: true, pending: true, duplicate: true, reversalId: claim.refundRequest.finixReversalId });
      }
      if (claim.refundRequest.status === "FAILED") {
        return toSafeErrorResponse(claim.refundRequest.failureMessage || "This refund could not be completed.", 400);
      }
      // Still PENDING and not ours — never fire Finix again blindly.
      logPaymentSafetyEvent("REFUND_STATUS_UNCERTAIN", {
        churchId: auth.churchId,
        finixTransferId: payment.finixTransferId,
        refundRequestId: claim.refundRequest.id,
        source: "checkout",
        route: `/api/merchant/invoices/${invoiceId}/payments/${paymentId}/refund`,
        detail: "RefundRequest still PENDING from another request — refusing to call Finix again",
      });
      return NextResponse.json(
        { success: false, code: "REFUND_STATUS_UNCERTAIN", message: "A refund for this payment is already being processed.", retryable: false },
        { status: 409 }
      );
    }

    try {
      const reversal = await finixClient.createTransferReversal(payment.finixTransferId, {
        refund_amount: requestedCents,
        idempotency_id: `refund:${claim.refundRequest.id}`,
        tags: { source: "wgc_invoice_refund", churchId: auth.churchId, invoiceId, invoicePaymentId: payment.id, refundRequestId: claim.refundRequest.id },
      });
      await prisma.$transaction([
        prisma.refundRequest.update({ where: { id: claim.refundRequest.id }, data: { status: "SUCCEEDED", finixReversalId: reversal.id } }),
        prisma.finixRefundOrReversal.upsert({
          where: { finixReversalId: reversal.id },
          create: {
            finixReversalId: reversal.id,
            churchId: auth.churchId,
            refundRequestId: claim.refundRequest.id,
            finixOriginalTransferId: payment.finixTransferId,
            amountCents: reversal.amount ?? requestedCents,
            currency: reversal.currency ?? invoice.currency,
            state: reversal.state ?? "PENDING",
            type: reversal.type ?? "REVERSAL",
            subtype: reversal.subtype ?? null,
            source: "wgc_invoice_refund",
            rawJsonRedacted: redactFinixPayload(reversal) as Prisma.InputJsonValue,
            createdAtFinix: reversal.created_at ? new Date(reversal.created_at) : new Date(),
            lastSyncedAt: new Date(),
          },
          update: { refundRequestId: claim.refundRequest.id, state: reversal.state ?? undefined, rawJsonRedacted: redactFinixPayload(reversal) as Prisma.InputJsonValue, lastSyncedAt: new Date() },
        }),
      ]);
    } catch (err) {
      const ambiguous = err instanceof Error && /timeout|timed out|abort|econnreset|network/i.test(err.message);
      await prisma.refundRequest
        .update({
          where: { id: claim.refundRequest.id },
          data: ambiguous
            ? { failureMessage: "Timed out or lost connection while confirming with the processor — status unknown." }
            : { status: "FAILED", failureMessage: err instanceof Error ? err.message.slice(0, 500) : "Refund rejected by processor." },
        })
        .catch((updateErr) => console.error(`Failed to record invoice refund outcome for request ${claim.refundRequest.id}:`, updateErr));
      if (ambiguous) {
        logPaymentSafetyEvent("REFUND_STATUS_UNCERTAIN", {
          churchId: auth.churchId,
          finixTransferId: payment.finixTransferId,
          refundRequestId: claim.refundRequest.id,
          source: "checkout",
          route: `/api/merchant/invoices/${invoiceId}/payments/${paymentId}/refund`,
          detail: "Timeout/network error calling Finix's reversal endpoint — outcome unknown, left PENDING for reconciliation (Stage 2)",
        });
        return NextResponse.json(
          { success: false, code: "REFUND_STATUS_UNCERTAIN", message: "We’re confirming this refund with the processor. Please do not retry.", retryable: false },
          { status: 503 }
        );
      }
      return toSafeErrorResponse(err, 502, { action: "refundInvoicePayment", resourceId: payment.id });
    }
    // The webhook's reconcileInvoicePaymentReversal() will apply
    // refundedCents/status once Finix confirms the reversal — this route
    // doesn't apply it optimistically, so a declined reversal never leaves
    // the invoice's balance wrong.
    return NextResponse.json({ success: true, pending: true });
  }

  // OFFLINE: no processor round-trip — apply immediately.
  const now = new Date();
  const newRefundedCents = payment.refundedCents + requestedCents;
  const newPaymentStatus = newRefundedCents >= payment.grossAmountCents ? "REFUNDED" : "PARTIALLY_REFUNDED";

  const result = await prisma.$transaction(async (tx) => {
    await tx.invoicePayment.update({
      where: { id: payment.id },
      data: { refundedCents: newRefundedCents, status: newPaymentStatus },
    });

    const payments = await tx.invoicePayment.findMany({
      where: { invoiceId: invoice.id, status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] } },
    });
    // The in-memory list above hasn't picked up the update just made in
    // this same transaction — patch it in explicitly rather than re-query,
    // since calculateInvoiceBalance needs the post-refund refundedCents.
    const patchedPayments = payments.map((p) => (p.id === payment.id ? { ...p, refundedCents: newRefundedCents, status: newPaymentStatus } : p));
    const balance = calculateInvoiceBalance({ totalCents: invoice.totalCents, payments: patchedPayments });
    const derivedStatus = computeDerivedInvoiceStatus({
      currentStatus: invoice.status as InvoiceStatus,
      balanceCents: balance.balanceCents,
      totalCents: invoice.totalCents,
      hasBeenViewed: Boolean(invoice.firstViewedAt),
      dueDate: invoice.dueDate,
      now,
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaidCents: balance.amountPaidCents,
        refundedCents: balance.refundedCents,
        balanceCents: balance.balanceCents,
        status: derivedStatus,
      },
    });

    await tx.invoiceActivity.create({
      data: {
        invoiceId: invoice.id,
        churchId: invoice.churchId,
        activityType: "invoice.offline_payment_refunded",
        actorUserId: auth.userId,
        actorEmail: auth.email,
        metadata: { paymentId: payment.id, amountCents: requestedCents },
      },
    });

    return { balanceCents: balance.balanceCents, status: derivedStatus };
  });

  await logDashboardAction({
    churchId: auth.churchId,
    actorUserId: auth.userId,
    actorEmail: auth.email,
    actorRole: auth.rawRole,
    action: "invoice.offline_payment_refunded",
    entityType: "invoice",
    entityId: invoiceId,
    metadata: { paymentId: payment.id, amountCents: requestedCents },
    req,
  });

  const { recordInvoiceUsageEvent } = await import("@/lib/billing/invoiceUsageLedger");
  await recordInvoiceUsageEvent({
    organizationId: auth.churchId,
    invoiceId,
    invoicePaymentId: payment.id,
    eventType: newPaymentStatus === "REFUNDED" ? "INVOICE_REFUNDED" : "INVOICE_PARTIALLY_PAID",
    amountPaidCents: requestedCents,
    // Idempotent per refund-amount-application, not per route call — a
    // retried request with the same resulting refundedCents never
    // double-counts, but two genuinely separate partial refunds each get
    // their own key.
    idempotencyKey: `${payment.id}:REFUND:${newRefundedCents}`,
  }).catch((err) => console.error("Invoice usage ledger recording failed (non-fatal):", err));

  return NextResponse.json({ success: true, ...result });
}
