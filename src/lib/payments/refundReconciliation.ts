import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { redactFinixPayload } from "@/lib/finix/redact";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";

/**
 * PRIORITY 7/8 follow-up — the exact gap the persisted RefundRequest claim
 * does NOT close by itself, documented and given a minimal Stage 1 answer
 * here; the actual scheduled worker is Stage 2 (see the module comment on
 * PaymentPostProcessJob once that lands).
 *
 * ==========================================================================
 * THE FAILURE THIS ADDRESSES
 * ==========================================================================
 * 1. Refund route atomically claims a RefundRequest row, status PENDING.
 * 2. WGC calls Finix's /transfer_reversals with idempotency_id =
 *    `refund:${refundRequest.id}`.
 * 3. Finix creates the reversal and returns 201/200.
 * 4. The WGC process dies (crash, OOM, deploy, connection loss) BEFORE the
 *    response is read or before the follow-up DB write (RefundRequest.status
 *    -> SUCCEEDED, finixReversalId set) completes.
 *
 * Result: Finix has a real reversal. WGC's RefundRequest row is stuck at
 * PENDING forever, with no finixReversalId recorded anywhere.
 *
 * ==========================================================================
 * WHAT ALREADY PROTECTS MONEY TODAY (Stage 1, live now)
 * ==========================================================================
 * The refund routes never treat "RefundRequest already exists and is
 * PENDING" as license to retry Finix — see the `!isFreshClaim` branch in
 * both refund routes: a same-clientRefundId retry against a stuck PENDING
 * row gets a 409 REFUND_STATUS_UNCERTAIN, not a second Finix call. So the
 * invariant ONE REFUND INTENT -> AT MOST ONE FINIX REVERSAL already holds
 * even in this exact failure mode — what's missing is only WGC's own
 * visibility into the true result, not money safety.
 *
 * ==========================================================================
 * WHAT'S MISSING (this file exists to close it)
 * ==========================================================================
 * WGC has no automatic way to learn "Finix actually did create reversal
 * REV_xyz for this RefundRequest" — today that requires a human checking
 * Finix's dashboard and fixing the row by hand. reconcileRefundRequest()
 * below is the reusable repair: given a stuck RefundRequest, it lists the
 * transfer's reversals from Finix and matches by tags.refundRequestId
 * (set explicitly on every reversal WGC creates — see both refund routes'
 * `tags:` payload) rather than by amount/timing, then applies the real
 * result to WGC's own records. It NEVER creates a new reversal itself —
 * matching is the only thing it's allowed to do.
 *
 * findStaleRefundRequests() is the query a Stage 2 cron/worker will poll on
 * a schedule; nothing calls it automatically yet in Stage 1 — there is no
 * scheduled job wired up to this file. Building the query and the repair
 * function now, with no automatic trigger, is deliberate: it's the
 * reusable path Stage 2 needs, without taking on "run a worker on every
 * request" as a Stage 1 concern.
 */

const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1000; // 15 minutes

export interface StaleRefundRequest {
  id: string;
  churchId: string;
  finixTransferId: string;
  clientRefundId: string;
  amountCents: number | null;
  updatedAt: Date;
}

/** Read-only — the actual query a Stage 2 scheduled worker will call. */
export async function findStaleRefundRequests(staleAfterMs: number = DEFAULT_STALE_AFTER_MS, limit = 50): Promise<StaleRefundRequest[]> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  return prisma.refundRequest.findMany({
    where: { status: "PENDING", updatedAt: { lt: cutoff } },
    select: { id: true, churchId: true, finixTransferId: true, clientRefundId: true, amountCents: true, updatedAt: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
}

export type RefundReconcileResult =
  | { outcome: "reconciled_succeeded"; finixReversalId: string }
  | { outcome: "reconciled_failed" }
  | { outcome: "still_unknown" }
  | { outcome: "error"; error: string };

/**
 * The one reusable repair function — never creates a Finix reversal,
 * only discovers and records the real result of a reversal WGC already
 * (ambiguously) attempted. Safe to call repeatedly on the same
 * RefundRequest; safe to call concurrently with itself (the update below
 * is a no-op if another caller already resolved it, since it's scoped to
 * `status: "PENDING"` in the WHERE clause — see updateMany usage).
 */
export async function reconcileRefundRequest(refundRequestId: string): Promise<RefundReconcileResult> {
  const refundRequest = await prisma.refundRequest.findUnique({ where: { id: refundRequestId } });
  if (!refundRequest) return { outcome: "error", error: "RefundRequest not found" };
  if (refundRequest.status !== "PENDING") {
    // Already resolved (possibly by a concurrent reconciliation pass, or
    // the original request actually did complete its own write after
    // all) — nothing to do.
    return refundRequest.status === "SUCCEEDED" && refundRequest.finixReversalId
      ? { outcome: "reconciled_succeeded", finixReversalId: refundRequest.finixReversalId }
      : { outcome: "reconciled_failed" };
  }

  try {
    const response = await finixClient.listTransferReversals(refundRequest.finixTransferId);
    const reversals: Array<Record<string, unknown>> = response?._embedded?.reversals ?? [];
    // Match by the id WGC itself stamped into tags at creation time — never
    // by amount/timing, which could coincidentally match an unrelated
    // reversal on the same transfer.
    const match = reversals.find((r) => (r.tags as Record<string, unknown> | undefined)?.refundRequestId === refundRequestId);

    if (!match || typeof match.id !== "string") {
      // Finix genuinely has no record of this reversal — the original
      // call most likely never reached Finix at all (died before the
      // request went out, or Finix rejected it before creating anything).
      // Safe to mark FAILED: no reversal exists to lose track of, and a
      // human/donor can retry with a fresh clientRefundId.
      const updated = await prisma.refundRequest.updateMany({
        where: { id: refundRequestId, status: "PENDING" },
        data: { status: "FAILED", failureMessage: "Reconciliation found no matching reversal at Finix — original request likely never completed." },
      });
      if (updated.count === 0) return { outcome: "still_unknown" }; // lost a race to another reconciler; re-check next pass
      logPaymentSafetyEvent("REFUND_RECONCILIATION_FAILED", {
        churchId: refundRequest.churchId,
        finixTransferId: refundRequest.finixTransferId,
        refundRequestId,
        source: "reconciliation",
        detail: "No matching reversal found at Finix — marked FAILED, original request likely never completed",
      });
      return { outcome: "reconciled_failed" };
    }

    const reversalId = match.id;
    await prisma.$transaction([
      prisma.refundRequest.updateMany({
        where: { id: refundRequestId, status: "PENDING" },
        data: { status: "SUCCEEDED", finixReversalId: reversalId },
      }),
      prisma.finixRefundOrReversal.upsert({
        where: { finixReversalId: reversalId },
        create: {
          finixReversalId: reversalId,
          churchId: refundRequest.churchId,
          refundRequestId,
          finixOriginalTransferId: refundRequest.finixTransferId,
          amountCents: typeof match.amount === "number" ? match.amount : refundRequest.amountCents,
          currency: typeof match.currency === "string" ? match.currency : undefined,
          state: typeof match.state === "string" ? match.state : "PENDING",
          type: typeof match.type === "string" ? match.type : "REVERSAL",
          subtype: typeof match.subtype === "string" ? match.subtype : null,
          source: "reconciliation",
          rawJsonRedacted: redactFinixPayload(match) as Prisma.InputJsonValue,
          createdAtFinix: typeof match.created_at === "string" ? new Date(match.created_at) : new Date(),
          lastSyncedAt: new Date(),
        },
        update: { refundRequestId, state: typeof match.state === "string" ? match.state : undefined, lastSyncedAt: new Date() },
      }),
    ]);

    logPaymentSafetyEvent("REFUND_RECONCILED", {
      churchId: refundRequest.churchId,
      finixTransferId: refundRequest.finixTransferId,
      refundRequestId,
      finixReversalId: reversalId,
      source: "reconciliation",
      detail: "Recovered the real Finix reversal id for a RefundRequest left PENDING by a process death",
    });
    return { outcome: "reconciled_succeeded", finixReversalId: reversalId };
  } catch (err) {
    console.error(`Refund reconciliation failed for RefundRequest ${refundRequestId}:`, err);
    logPaymentSafetyEvent("REFUND_STUCK", {
      churchId: refundRequest.churchId,
      finixTransferId: refundRequest.finixTransferId,
      refundRequestId,
      source: "reconciliation",
      detail: err instanceof Error ? err.message.slice(0, 300) : "Reconciliation attempt failed",
    });
    return { outcome: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
