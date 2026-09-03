import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { redactFinixPayload } from "@/lib/finix/redact";
import { toSafeErrorResponse } from "@/lib/utils/errorNormalizer";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { requirePermission } from "@/lib/auth/permissions";
import { requireFullOrganizationContext } from "@/lib/auth/viewScope";
import { isAuthError } from "@/lib/auth/errors";
import { logDashboardAction } from "@/lib/dashboardAudit";
import { auditImpersonatedWrite } from "@/lib/auth/auditImpersonatedWrite";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { claimRefundRequestWithBalanceLock, RefundNotFoundError, RefundIneligibleError, RefundAmountError } from "@/lib/payments/refundRequestClaim";

function isAmbiguousFinixError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort") || msg.includes("econnreset") || msg.includes("network");
}

/**
 * ONE REFUND INTENT -> AT MOST ONE FINIX REVERSAL, even under a
 * double-click, a browser retry, or two admins acting on the same payment
 * at once.
 *
 * The guarantee has two independent layers, matching the checkout path's
 * design:
 *
 * 1. clientRefundId + a real DB unique constraint
 *    (RefundRequest.[finixTransferId, clientRefundId]) — a retried request
 *    for the SAME refund action (same clientRefundId) always resolves to
 *    the SAME RefundRequest row. The idempotency key sent to Finix is
 *    derived from that row's own id, so it's stable across retries.
 *
 * 2. A short, row-locked transaction (`SELECT ... FOR UPDATE` on the
 *    FinixTransfer row) that recomputes the remaining refundable balance —
 *    counting not just already-SUCCEEDED refunds but any OTHER
 *    RefundRequest currently PENDING against this same transfer — before
 *    claiming a new RefundRequest row. This is what stops two DIFFERENT
 *    refund intents (different clientRefundId, e.g. two admins) from both
 *    passing eligibility for overlapping amounts. The lock is held only
 *    for this short DB-only transaction, never across the Finix network
 *    call itself, so it can't hold a connection open during a slow
 *    reversal request.
 *
 * An ambiguous Finix failure (timeout/network — we don't know if the
 * reversal actually went through) leaves the RefundRequest PENDING rather
 * than FAILED, so a same-clientRefundId retry is refused (409) instead of
 * silently firing a second reversal. See PRIORITY 7/8 in the payment-
 * safety audit — Finix's actual idempotency behavior for
 * /transfer_reversals with a repeated idempotency_id has not been verified
 * against a live sandbox from this environment (its Finix credentials are
 * deliberately unavailable here); this design does not depend on Finix
 * honoring it to be correct.
 */
export async function POST(req: Request, { params }: { params: Promise<{ transferId: string }> }) {
  let auth;
  try {
    auth = await requireMerchantSession();
    requirePermission(auth, "canIssueRefunds");
    await requireFullOrganizationContext(auth);
    await auditImpersonatedWrite(auth, req);
  } catch (err) {
    if (isAuthError(err)) return toSafeErrorResponse(err.message, err.status);
    throw err;
  }

  const { transferId } = await params;
  const body = await req.json().catch(() => ({}));
  const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : undefined;
  // The frontend should always send a real one, generated once per
  // intentional refund action (e.g. once per open of the confirmation
  // dialog) — falling back to a fresh UUID here means a caller that omits
  // it gets no double-click protection for that specific request, only
  // the concurrent-different-intent protection from the balance-locking
  // transaction below.
  const clientRefundId = typeof body.clientRefundId === "string" && body.clientRefundId.trim() ? body.clientRefundId.trim() : crypto.randomUUID();

  const payment = await prisma.payment.findFirst({ where: { finixTransferId: transferId, churchId: auth.churchId }, select: { id: true } });

  let claim;
  try {
    claim = await claimRefundRequestWithBalanceLock({
      finixTransferId: transferId,
      churchId: auth.churchId,
      clientRefundId,
      requestedAmountCents: amountCents,
      requestedByUserId: auth.userId,
      requestedByEmail: auth.email,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : null,
      originalPaymentId: payment?.id ?? null,
    });
  } catch (err) {
    if (err instanceof RefundNotFoundError) return toSafeErrorResponse(err.message, 404);
    if (err instanceof RefundIneligibleError) return toSafeErrorResponse(err.message, 400);
    if (err instanceof RefundAmountError) return toSafeErrorResponse(err.message, 400);
    throw err;
  }

  const { refundRequest, isFreshClaim, finixMerchantId } = claim;

  if (!isFreshClaim) {
    if (refundRequest.status === "SUCCEEDED" && refundRequest.finixReversalId) {
      // True idempotent replay — the exact same refund action was already
      // completed. Return the same result, no second Finix call.
      logPaymentSafetyEvent("REFUND_DUPLICATE_PREVENTED", {
        churchId: auth.churchId,
        finixTransferId: transferId,
        refundRequestId: refundRequest.id,
        finixReversalId: refundRequest.finixReversalId,
        source: "checkout",
        route: `/api/merchant/transactions/payments/${transferId}/refund`,
        detail: "P2002 on RefundRequest[finixTransferId,clientRefundId] — replayed the already-completed reversal instead of calling Finix again",
      });
      return NextResponse.json({ success: true, reversalId: refundRequest.finixReversalId, state: "SUCCEEDED", duplicate: true });
    }
    if (refundRequest.status === "FAILED") {
      return toSafeErrorResponse(refundRequest.failureMessage || "This refund could not be completed.", 400);
    }
    // Still PENDING and this request didn't create it — either a
    // genuinely concurrent duplicate click, or a prior attempt left in an
    // ambiguous state by a timeout. Never fire Finix again blindly.
    logPaymentSafetyEvent("REFUND_STATUS_UNCERTAIN", {
      churchId: auth.churchId,
      finixTransferId: transferId,
      refundRequestId: refundRequest.id,
      source: "checkout",
      route: `/api/merchant/transactions/payments/${transferId}/refund`,
      detail: "RefundRequest still PENDING from another request — refusing to call Finix again",
    });
    return NextResponse.json(
      { success: false, code: "REFUND_STATUS_UNCERTAIN", message: "A refund for this transaction is already being processed. Please check back before retrying.", retryable: false },
      { status: 409 }
    );
  }

  try {
    const reversal = await finixClient.createTransferReversal(transferId, {
      ...(refundRequest.amountCents != null ? { refund_amount: refundRequest.amountCents } : {}),
      // Stable across any retry that resolves to this same RefundRequest
      // row (see the class doc comment above).
      idempotency_id: `refund:${refundRequest.id}`,
      tags: { source: "wgc_merchant_dashboard", merchantId: finixMerchantId ?? "", churchId: auth.churchId, refundRequestId: refundRequest.id },
    });

    await prisma.$transaction([
      prisma.refundRequest.update({ where: { id: refundRequest.id }, data: { status: "SUCCEEDED", finixReversalId: reversal.id } }),
      prisma.finixRefundOrReversal.upsert({
        where: { finixReversalId: reversal.id },
        create: {
          finixReversalId: reversal.id,
          churchId: auth.churchId,
          refundRequestId: refundRequest.id,
          originalPaymentId: refundRequest.originalPaymentId,
          finixOriginalTransferId: transferId,
          finixMerchantId,
          amountCents: reversal.amount ?? refundRequest.amountCents,
          currency: reversal.currency,
          state: reversal.state ?? "PENDING",
          type: reversal.type ?? "REVERSAL",
          subtype: reversal.subtype ?? null,
          source: "wgc_merchant_dashboard",
          rawJsonRedacted: redactFinixPayload(reversal) as Prisma.InputJsonValue,
          createdAtFinix: reversal.created_at ? new Date(reversal.created_at) : new Date(),
          lastSyncedAt: new Date(),
        },
        update: {
          refundRequestId: refundRequest.id,
          state: reversal.state ?? undefined,
          rawJsonRedacted: redactFinixPayload(reversal) as Prisma.InputJsonValue,
          lastSyncedAt: new Date(),
        },
      }),
    ]);

    await logDashboardAction({
      churchId: auth.churchId,
      actorUserId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.rawRole,
      action: "payment.refund_issued",
      entityType: "Payment",
      entityId: transferId,
      metadata: {
        reversalId: reversal.id,
        refundRequestId: refundRequest.id,
        amountCents: reversal.amount ?? refundRequest.amountCents,
        state: reversal.state ?? "PENDING",
        isPartial: refundRequest.amountCents != null,
      },
      req,
    });

    return NextResponse.json({ success: true, reversalId: reversal.id, state: reversal.state });
  } catch (error: unknown) {
    const ambiguous = isAmbiguousFinixError(error);
    await prisma.refundRequest
      .update({
        where: { id: refundRequest.id },
        data: ambiguous
          ? { failureMessage: "Timed out or lost connection while confirming with the processor — status unknown." }
          : { status: "FAILED", failureMessage: error instanceof Error ? error.message.slice(0, 500) : "Refund rejected by processor." },
      })
      .catch((updateErr) => console.error(`Failed to record refund outcome for request ${refundRequest.id}:`, updateErr));

    if (ambiguous) {
      logPaymentSafetyEvent("REFUND_STATUS_UNCERTAIN", {
        churchId: auth.churchId,
        finixTransferId: transferId,
        refundRequestId: refundRequest.id,
        source: "checkout",
        route: `/api/merchant/transactions/payments/${transferId}/refund`,
        detail: "Timeout/network error calling Finix's reversal endpoint — outcome unknown, left PENDING for reconciliation (Stage 2)",
      });
      return NextResponse.json(
        { success: false, code: "REFUND_STATUS_UNCERTAIN", message: "We’re confirming this refund with the processor. Please do not retry.", retryable: false },
        { status: 503 }
      );
    }

    console.error(`Refund failed for transfer ${transferId}:`, error);
    return toSafeErrorResponse(error, 400, {
      userId: auth.userId,
      organizationId: auth.churchId,
      route: `/api/merchant/transactions/payments/${transferId}/refund`,
      action: "CREATE_REFUND",
      resourceId: transferId,
    });
  }
}
