import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Read-only recovery endpoint for a donor left on "Confirming your
 * payment…" after a merchandise checkout returned PAYMENT_STATUS_UNCERTAIN
 * (see checkoutService.ts). Mirrors
 * /api/g/[slug]/payment-attempt/[clientAttemptId]/route.ts exactly — NEVER
 * initiates a payment or any write, only reports on state that already
 * exists.
 *
 * Scoped by both slug and clientAttemptId so a caller can't enumerate
 * another organization's checkout attempts by guessing IDs.
 */
export async function GET(req: Request, { params }: { params: Promise<{ clientAttemptId: string }> }) {
  const { clientAttemptId } = await params;
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  }

  const link = await prisma.givingLink.findUnique({ where: { publicSlug: slug }, select: { churchId: true } });
  if (!link) {
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  }

  // Explicit `select` — excludes donorId and every other WgcCheckout
  // column beyond what this endpoint needs to report a status.
  const checkout = await prisma.wgcCheckout.findUnique({
    where: { clientAttemptId },
    select: { churchId: true, paymentStatus: true, finixTransferId: true },
  });
  if (!checkout || checkout.churchId !== link.churchId) {
    return NextResponse.json({ status: "NOT_FOUND" }, { status: 404 });
  }

  const s = (checkout.paymentStatus || "").toUpperCase();
  if (s === "SUCCEEDED") return NextResponse.json({ status: "SUCCEEDED", finixTransferId: checkout.finixTransferId });
  if (s === "FAILED") return NextResponse.json({ status: "FAILED" });
  // PENDING or UNCERTAIN — still unresolved, keep polling.
  return NextResponse.json({ status: "PROCESSING" });
}
