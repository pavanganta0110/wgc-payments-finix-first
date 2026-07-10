import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { redactFinixPayload } from "@/lib/finix/redact";

export async function POST(req: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { transferId } = await params;

  const transfer = await prisma.finixTransfer.findFirst({
    where: { finixTransferId: transferId, churchId: session.churchId },
  });
  if (!transfer) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const amountCents = typeof body.amountCents === "number" ? Math.round(body.amountCents) : undefined;

  if (amountCents != null && (amountCents <= 0 || amountCents > (transfer.amountCents ?? 0))) {
    return NextResponse.json({ error: "Refund amount must be between $0.01 and the original payment amount." }, { status: 400 });
  }

  try {
    const reversal = await finixClient.createTransferReversal(transferId, {
      ...(amountCents != null ? { refund_amount: amountCents } : {}),
      tags: { source: "wgc_merchant_dashboard", merchantId: transfer.finixMerchantId ?? "", churchId: session.churchId },
    });

    // Persist immediately so the UI reflects it right away — the
    // transfer.updated webhook will also sync this independently, this is
    // just so the merchant doesn't have to wait on webhook delivery.
    await prisma.finixRefundOrReversal.upsert({
      where: { finixReversalId: reversal.id },
      create: {
        finixReversalId: reversal.id,
        churchId: session.churchId,
        finixOriginalTransferId: transferId,
        finixMerchantId: transfer.finixMerchantId,
        amountCents: reversal.amount ?? amountCents ?? transfer.amountCents,
        currency: reversal.currency ?? transfer.currency,
        state: reversal.state ?? "PENDING",
        type: reversal.type ?? "REVERSAL",
        subtype: reversal.subtype ?? null,
        source: "wgc_merchant_dashboard",
        rawJsonRedacted: redactFinixPayload(reversal),
        createdAtFinix: reversal.created_at ? new Date(reversal.created_at) : new Date(),
        lastSyncedAt: new Date(),
      },
      update: {
        state: reversal.state ?? undefined,
        rawJsonRedacted: redactFinixPayload(reversal),
        lastSyncedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, reversalId: reversal.id, state: reversal.state });
  } catch (error: any) {
    console.error(`Refund failed for transfer ${transferId}:`, error);
    const finixError = error?.details?._embedded?.errors?.[0];
    return NextResponse.json(
      { error: finixError?.failure_message || finixError?.message || "We couldn't process this refund. Please try again." },
      { status: 402 }
    );
  }
}
