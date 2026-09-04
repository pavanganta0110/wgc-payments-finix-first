import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { parseFinixDate } from "@/lib/finix/parseFinixDate";
import { syncPaymentInstrument } from "@/lib/finix/sync/syncPaymentInstruments";
import { hashSetupLinkToken } from "@/lib/subscriptions/setupLinkToken";
import { checkSetupLinkRateLimit } from "@/lib/subscriptions/setupLinkRateLimit";
import { isValidEmail, normalizePhone } from "@/lib/donors/donorContact";
import { logPaymentSafetyEvent } from "@/lib/observability/paymentSafetyEvents";
import { enqueueBackgroundJobInTransaction } from "@/lib/jobs/backgroundJobs";

const TERMS_VERSION = "2026-01-recurring-donor-v1";

/**
 * Public, unauthenticated completion of a donor-initiated recurring setup.
 * Mirrors the exact tokenization pattern already used by /api/g/[slug]/donate:
 * the browser only ever sends an opaque Finix.js token (or wallet token),
 * never raw card/bank data. Terms (amount/frequency/dates) always come from
 * the server-stored SubscriptionSetupLink row — never from the request body
 * — so a tampered client request cannot alter what the donor is charged.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = req.headers.get("x-forwarded-for") || "unknown";
  if (!checkSetupLinkRateLimit(`complete:${ip}`)) {
    return NextResponse.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const body = await req.json();
  const { finixToken, donorFirstName, donorLastName, donorPhone, consentAccepted } = body;

  if (!finixToken) return NextResponse.json({ error: "Missing payment token" }, { status: 400 });
  if (consentAccepted !== true) return NextResponse.json({ error: "You must accept the recurring donation terms to continue" }, { status: 400 });

  const tokenHash = hashSetupLinkToken(token);

  // Atomic single-use claim: only the request that flips SENT/PENDING ->
  // COMPLETING wins; a concurrent double-submit (double-click, network
  // retry) sees count === 0 and is rejected rather than creating two
  // subscriptions from one link.
  const claim = await prisma.subscriptionSetupLink.updateMany({
    where: { tokenHash, status: { in: ["PENDING", "SENT"] }, expiresAt: { gt: new Date() } },
    data: { status: "COMPLETING" },
  });
  if (claim.count === 0) {
    const existing = await prisma.subscriptionSetupLink.findUnique({ where: { tokenHash } });
    if (existing?.status === "COMPLETED") return NextResponse.json({ error: "This setup link has already been used." }, { status: 410 });
    if (existing?.status === "REVOKED") return NextResponse.json({ error: "This setup link has been revoked." }, { status: 410 });
    return NextResponse.json({ error: "This setup link is invalid or has expired." }, { status: 410 });
  }

  const link = await prisma.subscriptionSetupLink.findUnique({ where: { tokenHash } });
  if (!link) return NextResponse.json({ error: "This setup link is invalid." }, { status: 404 });

  // Once Finix confirms the subscription, the catch below must never
  // release this claim back to SENT — that would let the donor retry and
  // create a second real subscription for the same intent.
  let finixConfirmed = false;
  try {
    const church = await prisma.church.findUnique({ where: { id: link.churchId } });
    if (!church?.finixMerchantId) throw new Error("Organization is not fully onboarded");

    const firstName = (donorFirstName || link.donorFirstName || "").trim();
    const lastName = (donorLastName || link.donorLastName || "").trim();
    const email = link.donorEmail;
    if (!isValidEmail(email)) throw new Error("Invalid donor email on file");
    const normalizedPhone = donorPhone ? normalizePhone(donorPhone) : null;

    const identity = await finixClient.createBuyerIdentity({
      entity: { first_name: firstName || "Donor", last_name: lastName || "Donor", email, phone: normalizedPhone || undefined },
    });
    const identityId = identity?.id;
    if (!identityId) throw new Error("Failed to create buyer identity");

    const instrument = await finixClient.createPaymentInstrument({ identity: identityId, token: finixToken, type: "TOKEN" });
    const instrumentId = instrument?.id;
    if (!instrumentId) throw new Error("Failed to create payment instrument");

    const donorRecord = await prisma.donor.upsert({
      where: { finixIdentityId: identityId },
      create: { churchId: link.churchId, finixIdentityId: identityId, name: `${firstName} ${lastName}`.trim() || null, email, phone: normalizedPhone },
      update: { name: `${firstName} ${lastName}`.trim() || undefined, phone: normalizedPhone ?? undefined },
    });

    try {
      await syncPaymentInstrument(instrumentId, { churchId: link.churchId, donorId: donorRecord.id });
    } catch (err) {
      console.error("Failed to snapshot payment instrument for setup-link completion:", err);
    }

    // Stable across any retry of THIS SAME link — the link's own atomic
    // COMPLETING claim above is what stops a concurrent double-submit from
    // reaching this call twice, but this key is Finix-side defense in
    // depth for the same intent (mirrors donate/route.ts's idempotencyId).
    const idempotencyId = `setup-link:${link.id}`;
    const finixSubscription = await finixClient.createSubscription({
      amount: link.amountCents,
      currency: "USD",
      billing_interval: link.billingInterval as any,
      linked_to: church.finixMerchantId,
      linked_type: "MERCHANT",
      buyer_details: { identity_id: identityId, instrument_id: instrumentId },
      idempotency_id: idempotencyId,
      tags: { source: "wgc_setup_link", churchId: link.churchId, setupLinkId: link.id },
    });
    if (!finixSubscription?.id) throw new Error("Failed to create subscription");
    // From here, Finix has a real subscription — the outer catch below
    // must never again release this link's claim back to SENT.
    finixConfirmed = true;

    const instrumentSnapshot = await prisma.finixPaymentInstrumentSnapshot.findUnique({ where: { finixPaymentInstrumentId: instrumentId } });

    // A payment-update-link completion cancels the referenced subscription
    // (Finix has no in-place "change payment method" endpoint) and chains
    // the replacement, rather than leaving the old subscription active and
    // creating an unrelated second one.
    let oldSubscriptionForUpdate: { id: string; finixSubscriptionId: string; attributedUserId: string | null } | null = null;
    if (link.updateTargetFinixSubscriptionId) {
      oldSubscriptionForUpdate = await prisma.finixSubscription.findFirst({
        where: { finixSubscriptionId: link.updateTargetFinixSubscriptionId, churchId: link.churchId },
        select: { id: true, finixSubscriptionId: true, attributedUserId: true },
      });
      if (oldSubscriptionForUpdate) {
        await finixClient.cancelSubscription(oldSubscriptionForUpdate.finixSubscriptionId);
      }
    }

    // TRANSACTIONAL OUTBOX (Stage 2 Task 2, Flow 2b): required local
    // subscription/setup state and the required notification job commit
    // together — closes the crash window between "Finix subscription
    // created" and "local state fully durable" that existed here before
    // (these writes ran as separate, non-atomic statements, and the two
    // confirmation emails were synchronous swallow-on-failure sends with
    // no durable record they still needed sending after a crash). The
    // Finix subscription (and cancellation of any superseded subscription)
    // already happened above, before this transaction ever opens —
    // nothing external is called from inside it.
    await prisma.$transaction(async (tx) => {
      // upsert (keyed on finixSubscriptionId @unique), not a bare create —
      // Postgres compiles this to an atomic INSERT ... ON CONFLICT, so a
      // concurrent writer for this same Finix subscription (a raced retry,
      // or a subscription.* webhook arriving before this write completes)
      // can never throw an unhandled P2002 here; it converges safely.
      await tx.finixSubscription.upsert({
        where: { finixSubscriptionId: finixSubscription.id },
        create: {
          finixSubscriptionId: finixSubscription.id,
          churchId: link.churchId,
          donorId: donorRecord.id,
          fundId: link.fundId,
          finixMerchantId: church.finixMerchantId,
          finixBuyerIdentityId: identityId,
          finixPaymentInstrumentId: instrumentId,
          state: finixSubscription.state ?? "ACTIVE",
          amountCents: link.amountCents,
          currency: "USD",
          billingInterval: link.billingInterval,
          collectionMethod: "BILL_AUTOMATICALLY",
          nextBillingDate: parseFinixDate(finixSubscription.next_billing_date),
          startedAt: link.startDate,
          consentSource: "DONOR_DIRECT",
          supersedesSubscriptionId: oldSubscriptionForUpdate?.id ?? null,
          // Team-access Checkpoint 3: this setup link has no giving-link
          // association (SubscriptionSetupLink is donor-direct/admin-sent,
          // not tied to a GivingLink) — no attribution can be proven here.
          // Exception: a payment-update-link is a continuation of an
          // existing subscription (see supersedesSubscriptionId above), so it
          // inherits that subscription's already-snapshotted attribution
          // rather than losing it on a payment-method change.
          attributedUserId: oldSubscriptionForUpdate?.attributedUserId ?? null,
          lastSyncedAt: new Date(),
        },
        update: { state: finixSubscription.state ?? undefined, lastSyncedAt: new Date() },
      });

      if (oldSubscriptionForUpdate) {
        await tx.finixSubscription.update({
          where: { id: oldSubscriptionForUpdate.id },
          data: { canceledAt: new Date(), cancelReason: "Replaced via donor payment method update", state: "CANCELED", lastSyncedAt: new Date() },
        });
      }

      await tx.subscriptionConsent.create({
        data: {
          churchId: link.churchId,
          donorId: donorRecord.id,
          finixSubscriptionId: finixSubscription.id,
          consentSource: "DONOR_DIRECT",
          termsVersion: TERMS_VERSION,
          ipAddress: ip !== "unknown" ? ip : null,
          userAgent: req.headers.get("user-agent") || null,
          setupLinkId: link.id,
          recurringTermsSnapshot: {
            amountCents: link.amountCents,
            billingInterval: link.billingInterval,
            startDate: link.startDate.toISOString(),
            endDate: link.endDate?.toISOString() ?? null,
            organizationName: church.name,
          },
          donorNameSnapshot: `${firstName} ${lastName}`.trim(),
          donorEmailSnapshot: email,
          amountCentsSnapshot: link.amountCents,
          frequencySnapshot: link.billingInterval,
          startDateSnapshot: link.startDate,
          paymentMethodLastFourSnapshot: instrumentSnapshot?.cardLast4 || instrumentSnapshot?.bankLast4 || null,
          organizationNameSnapshot: church.name,
        },
      });

      await tx.subscriptionSetupLink.update({
        where: { id: link.id },
        data: { status: "COMPLETED", completedAt: new Date(), donorId: donorRecord.id, finixSubscriptionId: finixSubscription.id },
      });

      // REGENERABLE/optional (Stage 2 Task 2 classification): plain
      // confirmation emails, not tax receipts — the subscription itself is
      // already durable regardless of whether these send. Still enqueued
      // in the same transaction so there's no crash window at all, not
      // even a brief one. See handleSetupLinkConfirmation's own comment
      // for the accepted at-least-once-delivery risk (same as
      // SEND_PLAIN_EMAIL elsewhere).
      await enqueueBackgroundJobInTransaction(tx, {
        jobType: "SETUP_LINK_CONFIRMATION",
        entityType: "FinixSubscription",
        entityId: finixSubscription.id,
        dedupeKey: `SETUP_LINK_CONFIRMATION:subscription:${finixSubscription.id}`,
        payload: {
          donorEmail: email,
          donorName: `${firstName} ${lastName}`.trim(),
          churchName: church.name,
          churchContactEmail: church.primaryContactEmail,
          amountCents: link.amountCents,
          billingInterval: link.billingInterval,
        },
      });
    });

    return NextResponse.json({
      success: true,
      donorName: `${firstName} ${lastName}`.trim(),
      amountCents: link.amountCents,
      billingInterval: link.billingInterval,
      nextBillingDate: parseFinixDate(finixSubscription.next_billing_date),
      paymentMethodLastFour: instrumentSnapshot?.cardLast4 || instrumentSnapshot?.bankLast4 || null,
    });
  } catch (err: any) {
    if (finixConfirmed) {
      // Finix already created a real subscription — never release the
      // claim (that would invite a donor retry to create a second one) and
      // never say "please try again." This is the exact PAYMENT_STATUS_UNCERTAIN
      // rule applied to a subscription: an admin/human needs to reconcile
      // subscriptionSetupLink status COMPLETING against the real Finix
      // subscription (tags.setupLinkId on the subscription identifies it).
      logPaymentSafetyEvent("PAYMENT_STATUS_UNCERTAIN", {
        churchId: link.churchId,
        source: "checkout",
        route: "/api/setup/[token]/complete",
        detail: `Finix confirmed subscription but a later write failed — subscriptionSetupLink ${link.id} left COMPLETING for manual/reconciliation review`,
      });
      return NextResponse.json(
        { success: false, code: "PAYMENT_STATUS_UNCERTAIN", error: "We’re confirming your recurring donation setup. Please do not submit this form again — contact the organization if you don’t receive a confirmation shortly." },
        { status: 503 }
      );
    }
    // Release the claim so the donor can retry with the same link rather
    // than being permanently locked out by a transient Finix API failure.
    await prisma.subscriptionSetupLink.update({
      where: { id: link.id },
      data: { status: "SENT", failureReason: err.message || "Setup failed" },
    });
    return NextResponse.json({ error: "We couldn't set up your recurring donation. Please check your payment details and try again." }, { status: 502 });
  }
}
