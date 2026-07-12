import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getSettingsPermissions } from "@/lib/settings/settingsPermissions";

export async function GET(req: Request) {
  const session = await getSession();
  const permissions = getSettingsPermissions(session?.role);
  if (!session || !session.churchId || !permissions.canView) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const church = await prisma.church.findUnique({ where: { id: session.churchId } });
  if (!church) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const onboarding = church.onboardingApplicationId
    ? await prisma.onboardingApplication.findUnique({ where: { id: church.onboardingApplicationId } })
    : null;

  const cardEnabled = Boolean(onboarding?.hasAcceptedCreditCardsPreviously || onboarding?.processingEnabled);
  const achEnabled = Boolean(onboarding?.bankInstrumentEnabled && onboarding?.processingEnabled);
  const applePayConfigured = Boolean(process.env.NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID);
  const googlePayConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID);

  return NextResponse.json({
    methods: [
      {
        key: "CARD",
        name: "Credit/Debit Card",
        status: cardEnabled ? "ENABLED" : onboarding ? "PENDING_APPROVAL" : "NOT_AVAILABLE",
        supportsDonationTypes: ["One-Time", "Recurring"],
        supportsRecurring: true,
        lastUpdated: onboarding?.updatedAt ?? null,
      },
      {
        key: "ACH",
        name: "ACH / Bank Account",
        status: achEnabled ? "ENABLED" : onboarding?.bankInstrumentId ? "PENDING_APPROVAL" : "REQUIRES_ACTION",
        supportsDonationTypes: ["One-Time", "Recurring"],
        supportsRecurring: true,
        lastUpdated: onboarding?.updatedAt ?? null,
        configurationNote: achEnabled ? null : "A verified bank account is required before ACH can be enabled.",
      },
      {
        key: "APPLE_PAY",
        name: "Apple Pay",
        status: applePayConfigured && cardEnabled ? "ENABLED" : "NOT_AVAILABLE",
        supportsDonationTypes: ["One-Time"],
        supportsRecurring: true,
        lastUpdated: null,
        // Domain verification/production approval for Apple Pay is configured once
        // at the WGC platform level (shared merchant ID), not per organization —
        // stating that plainly rather than implying a per-organization approval flow.
        configurationNote: applePayConfigured
          ? "Enabled at the platform level once card payments are active for your organization."
          : "Apple Pay is not currently configured on this WGC deployment.",
      },
      {
        key: "GOOGLE_PAY",
        name: "Google Pay",
        status: googlePayConfigured && cardEnabled ? "ENABLED" : "NOT_AVAILABLE",
        supportsDonationTypes: ["One-Time"],
        supportsRecurring: true,
        lastUpdated: null,
        configurationNote: googlePayConfigured
          ? "Enabled at the platform level once card payments are active for your organization."
          : "Google Pay is not currently configured on this WGC deployment.",
      },
    ],
  });
}
