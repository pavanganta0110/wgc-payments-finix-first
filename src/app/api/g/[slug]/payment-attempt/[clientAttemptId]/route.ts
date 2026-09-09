import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Read-only recovery endpoint for a donor left on "Confirming your
 * donation…" after a PAYMENT_STATUS_UNCERTAIN response (see donate/route.ts).
 * NEVER initiates a payment, a Finix call, or any write — it only reports
 * on state that already exists, resolved by whatever already wrote it (the
 * synchronous checkout path, the webhook handler, or the webhook's own
 * orphan-payment recovery).
 *
 * Scoped by both slug and clientAttemptId so a caller can't enumerate
 * another organization's payment attempts by guessing IDs — a mismatch
 * between the two returns the same 404 as a genuinely unknown attempt.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string; clientAttemptId: string }> }) {
  const { slug, clientAttemptId } = await params;

  const link = await prisma.givingLink.findUnique({ where: { publicSlug: slug }, select: { churchId: true } });
  if (!link) {
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  }

  // Explicit `select` — deliberately excludes donorId, fraudSessionId,
  // note, amountCents/feeCents/totalCents, fundId/fundName, and every
  // other PaymentAttempt column. Nothing beyond these three fields is ever
  // read into memory here, so a future edit to this handler can't
  // accidentally spread donor-identifying data into the JSON response —
  // this endpoint is reachable with only a slug + a guessed/leaked
  // clientAttemptId, no session/auth of any kind.
  const attempt = await prisma.paymentAttempt.findUnique({
    where: { clientAttemptId },
    select: { churchId: true, finixTransferId: true, status: true },
  });
  if (!attempt || attempt.churchId !== link.churchId) {
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  }

  // The Payment/FinixSubscription record (once it exists) is the source of
  // truth — it can be more current than PaymentAttempt.status, which is
  // exactly the field that may have been left stale by the crash window
  // this endpoint exists to help recover from.
  if (attempt.finixTransferId) {
    const payment = await prisma.payment.findUnique({
      where: { finixTransferId: attempt.finixTransferId },
      select: { status: true, finixTransferId: true },
    });
    if (payment) {
      const s = (payment.status || "").toUpperCase();
      if (s === "SUCCEEDED") return NextResponse.json({ status: "SUCCEEDED", transferId: payment.finixTransferId });
      if (s === "FAILED" || s === "CANCELED") return NextResponse.json({ status: "FAILED" });
      return NextResponse.json({ status: "PROCESSING" });
    }

    // Recurring flow: the uncertain-response path stores the Finix
    // subscription id in this same field (see donate/route.ts).
    const subscription = await prisma.finixSubscription.findUnique({
      where: { finixSubscriptionId: attempt.finixTransferId },
      select: { finixSubscriptionId: true, state: true },
    });
    if (subscription) {
      return NextResponse.json({ status: "SUCCEEDED", subscriptionId: subscription.finixSubscriptionId });
    }
  }

  const s = (attempt.status || "").toUpperCase();
  if (s === "FAILED" || s === "CANCELED") return NextResponse.json({ status: "FAILED" });
  if (s === "SUCCEEDED") return NextResponse.json({ status: "SUCCEEDED", transferId: attempt.finixTransferId });
  // PROCESSING or PENDING — still unresolved, keep polling.
  return NextResponse.json({ status: "PROCESSING" });
}
