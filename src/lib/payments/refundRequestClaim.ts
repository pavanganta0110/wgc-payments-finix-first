import { Prisma, type RefundRequest } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { checkRefundEligibility } from "@/lib/payments/refundEligibility";

export class RefundNotFoundError extends Error {}
export class RefundIneligibleError extends Error {}
export class RefundAmountError extends Error {}

export interface RefundClaimResult {
  refundRequest: RefundRequest;
  isFreshClaim: boolean;
  finixMerchantId: string | null;
}

/**
 * ONE REFUND INTENT -> AT MOST ONE FINIX REVERSAL, and no two concurrent
 * refund intents can together exceed a transfer's real remaining
 * refundable balance. The single implementation both refund routes call —
 * the direct-payment refund route
 * (/api/merchant/transactions/payments/[transferId]/refund) and the
 * invoice-payment refund route
 * (/api/merchant/invoices/[invoiceId]/payments/[paymentId]/refund) — so
 * there is exactly one place this guarantee is implemented, not two
 * subtly different copies (see cold-review defect #3: the invoice route
 * previously read refundableCents with a plain unlocked query and never
 * accounted for other PENDING RefundRequest rows, so two concurrent
 * partial refunds could together exceed the payment's real balance).
 *
 * Both routes refund against the SAME underlying resource — a
 * FinixTransfer — so this also closes a cross-route over-refund gap for
 * free: a pending refund claimed via one route is now visible to the
 * other's balance calculation too, since both share this one
 * reservedPendingCents query.
 *
 * Sequence (all inside one short DB-only transaction — the Finix network
 * call happens OUTSIDE this function, in the caller, never under the
 * lock):
 *   1. `SELECT ... FOR UPDATE` on the FinixTransfer row — serializes any
 *      concurrent refund claim against the SAME transfer.
 *   2. Recompute remaining balance: transfer.amountCents minus completed/
 *      pending reversals minus every OTHER currently-PENDING RefundRequest
 *      against this transfer (reservedPendingCents) — this is what stops
 *      two DIFFERENT refund intents (different clientRefundId) from both
 *      passing eligibility for overlapping amounts.
 *   3. Atomically create (or, on a P2002 for a repeated clientRefundId,
 *      recover) the RefundRequest row.
 */
export async function claimRefundRequestWithBalanceLock(params: {
  finixTransferId: string;
  churchId: string;
  clientRefundId: string;
  requestedAmountCents?: number;
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  reason?: string | null;
  originalPaymentId?: string | null;
}): Promise<RefundClaimResult> {
  const { finixTransferId, churchId, clientRefundId, requestedAmountCents, requestedByUserId, requestedByEmail, reason, originalPaymentId } = params;

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "FinixTransfer" WHERE "finixTransferId" = ${finixTransferId} AND "churchId" = ${churchId} FOR UPDATE`;
    if (locked.length === 0) throw new RefundNotFoundError("This record could not be found.");

    const [transfer, refunds, bankReturns, pendingRequests] = await Promise.all([
      tx.finixTransfer.findFirst({ where: { finixTransferId, churchId } }),
      tx.finixRefundOrReversal.findMany({ where: { finixOriginalTransferId: finixTransferId, churchId } }),
      tx.bankReturn.findMany({ where: { originalTransferId: finixTransferId, churchId } }),
      tx.refundRequest.findMany({ where: { finixTransferId, churchId, status: "PENDING" } }),
    ]);
    if (!transfer) throw new RefundNotFoundError("This record could not be found.");

    const reservedPendingCents = pendingRequests.filter((r) => r.clientRefundId !== clientRefundId).reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
    const eligibility = checkRefundEligibility(transfer, refunds, bankReturns, churchId, reservedPendingCents);
    if (!eligibility.eligible) throw new RefundIneligibleError(eligibility.reason || "This transaction is not eligible for a refund.");
    if (requestedAmountCents != null && (requestedAmountCents <= 0 || requestedAmountCents > (eligibility.remainingCents ?? 0))) {
      throw new RefundAmountError("The refund amount cannot exceed the remaining refundable balance.");
    }

    try {
      const created = await tx.refundRequest.create({
        data: {
          churchId,
          originalPaymentId: originalPaymentId ?? null,
          finixTransferId,
          clientRefundId,
          requestedByUserId: requestedByUserId ?? null,
          requestedByEmail: requestedByEmail ?? null,
          amountCents: requestedAmountCents ?? eligibility.remainingCents ?? null,
          reason: reason ?? null,
          status: "PENDING",
        },
      });
      return { refundRequest: created, isFreshClaim: true, finixMerchantId: transfer.finixMerchantId };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const existing = await tx.refundRequest.findUnique({
          where: { finixTransferId_clientRefundId: { finixTransferId, clientRefundId } },
        });
        if (existing) return { refundRequest: existing, isFreshClaim: false, finixMerchantId: transfer.finixMerchantId };
      }
      throw err;
    }
  });
}
