import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processCombinedCheckout, CheckoutValidationError, CheckoutUncertainError } from "@/lib/integrations/printful/checkoutService";
import { toSafeMerchandiseErrorMessage } from "@/lib/integrations/printful/errors";

/**
 * Public — the ONLY route a donor's browser calls when their cart has
 * merchandise in it (donation-only submissions on a merchandise-enabled
 * page still go through here so donation + $0 cart share one code path;
 * see CheckoutValidationError below for the "need something" guard). A
 * giving page with merchandiseEnabled=false never calls this endpoint at
 * all — it keeps using /api/g/[slug]/donate exactly as before (spec item
 * 1's backwards-compatibility requirement).
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const {
    slug,
    clientAttemptId,
    donationAmountCents,
    cartItems,
    shippingOptionId,
    address,
    donor,
    paymentInstrumentId,
    token,
    paymentMethod,
    walletToken,
    walletBillingContact,
    fraudSessionId,
    isAnonymous,
    coverFees,
  } = body;

  // fraudSessionId is required for every method except bank/ACH — mirrors
  // /api/g/[slug]/donate, where Finix.Auth's fraud-session callback never
  // fires for a bank submission, so the frontend sends "" rather than
  // hanging forever waiting for one. Previously this route required it
  // unconditionally, which would have rejected every real bank submission
  // with "Missing required fields." before it ever reached checkoutService.
  if (!slug || !clientAttemptId || !donor?.name || !donor?.email || (paymentMethod !== "bank" && !fraudSessionId)) {
    return NextResponse.json({ success: false, error: "Missing required fields." }, { status: 400 });
  }

  const link = await prisma.givingLink.findUnique({ where: { publicSlug: slug } });
  if (!link) return NextResponse.json({ success: false, error: "This giving link could not be found." }, { status: 404 });

  try {
    const checkout = await processCombinedCheckout({
      churchId: link.churchId,
      givingLinkId: link.id,
      clientAttemptId,
      donationAmountCents: Number(donationAmountCents) || 0,
      cartItems: Array.isArray(cartItems) ? cartItems : [],
      shippingOptionId: shippingOptionId ?? null,
      address: address ?? null,
      donor,
      paymentInstrumentId,
      token,
      paymentMethod: paymentMethod === "apple_pay" || paymentMethod === "google_pay" || paymentMethod === "bank" ? paymentMethod : "card",
      walletToken,
      walletBillingContact,
      fraudSessionId,
      isAnonymous: Boolean(isAnonymous),
      coverFees: Boolean(coverFees),
    });

    // processCombinedCheckout can return an existing row (the idempotency
    // fast-path, or a P2002-losing concurrent request recovering the
    // winner's row) without throwing at all — its paymentStatus must be
    // translated the same way a freshly-thrown outcome would be, so a
    // caller can never read a still-PENDING/UNCERTAIN or a FAILED prior
    // attempt as a completed success.
    if (checkout.paymentStatus === "FAILED") {
      return NextResponse.json({ success: false, code: "PAYMENT_FAILED", error: "This order was not completed. No charge was made.", retryable: true }, { status: 402 });
    }
    if (checkout.paymentStatus === "PENDING" || checkout.paymentStatus === "UNCERTAIN") {
      return NextResponse.json(
        { success: false, code: "PAYMENT_STATUS_UNCERTAIN", error: "We're confirming your payment. Please do not submit this order again.", retryable: false },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      checkoutId: checkout.id,
      finixTransferId: checkout.finixTransferId,
      donationAmount: checkout.donationAmount,
      merchandiseAmount: checkout.merchandiseAmount,
      shippingAmount: checkout.shippingAmount,
      taxAmount: checkout.taxAmount,
      processingFeeAmount: checkout.processingFeeAmount,
      grandTotal: checkout.grandTotal,
      merchandiseOrderId: checkout.merchandiseOrderId,
    });
  } catch (err) {
    if (err instanceof CheckoutUncertainError) {
      return NextResponse.json({ success: false, code: "PAYMENT_STATUS_UNCERTAIN", error: err.message, retryable: false }, { status: 503 });
    }
    console.error("Merchandise checkout failed:", err);
    const message = err instanceof CheckoutValidationError ? err.message : toSafeMerchandiseErrorMessage(err);
    return NextResponse.json({ success: false, code: "PAYMENT_FAILED", error: message, retryable: true }, { status: 402 });
  }
}
