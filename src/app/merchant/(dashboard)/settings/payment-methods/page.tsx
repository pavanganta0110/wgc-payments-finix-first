import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import StateBadge from "@/components/merchant/StateBadge";
import { formatDateTimeCDT as formatDateTime } from "@/lib/formatDateTimeCDT";
import Link from "next/link";

export default async function PaymentMethodsSettingsPage() {
  const session = await getSession();
  const church = await prisma.church.findUnique({ where: { id: session!.churchId! } });
  if (!church) return null;

  const onboarding = church.onboardingApplicationId
    ? await prisma.onboardingApplication.findUnique({ where: { id: church.onboardingApplicationId } })
    : null;

  const cardEnabled = Boolean(onboarding?.hasAcceptedCreditCardsPreviously || onboarding?.processingEnabled);
  const achEnabled = Boolean(onboarding?.bankInstrumentEnabled && onboarding?.processingEnabled);
  const applePayConfigured = Boolean(process.env.NEXT_PUBLIC_APPLE_PAY_MERCHANT_ID);
  const googlePayConfigured = Boolean(process.env.NEXT_PUBLIC_GOOGLE_PAY_MERCHANT_ID);

  const methods = [
    {
      name: "Credit/Debit Card",
      status: cardEnabled ? "ENABLED" : onboarding ? "PENDING_APPROVAL" : "NOT_AVAILABLE",
      note: null as string | null,
      lastUpdated: onboarding?.updatedAt ?? null,
    },
    {
      name: "ACH / Bank Account",
      status: achEnabled ? "ENABLED" : onboarding?.bankInstrumentId ? "PENDING_APPROVAL" : "REQUIRES_ACTION",
      note: achEnabled ? null : "A verified bank account is required before ACH can be enabled.",
      lastUpdated: onboarding?.updatedAt ?? null,
    },
    {
      name: "Apple Pay",
      status: applePayConfigured && cardEnabled ? "ENABLED" : "NOT_AVAILABLE",
      note: applePayConfigured ? "Enabled at the platform level once card payments are active for your organization." : "Apple Pay is not currently configured on this WGC deployment.",
      lastUpdated: null,
    },
    {
      name: "Google Pay",
      status: googlePayConfigured && cardEnabled ? "ENABLED" : "NOT_AVAILABLE",
      note: googlePayConfigured ? "Enabled at the platform level once card payments are active for your organization." : "Google Pay is not currently configured on this WGC deployment.",
      lastUpdated: null,
    },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h3 className="text-sm font-bold text-slate-900 mb-1">Payment Methods</h3>
      <p className="text-xs text-slate-500 mb-6">Payment methods available to donors on your Giving Links.</p>

      <div className="space-y-3">
        {methods.map((m) => (
          <div key={m.name} className="flex items-start justify-between p-4 rounded-xl border border-slate-100">
            <div>
              <p className="text-sm font-semibold text-slate-800">{m.name}</p>
              {m.note && <p className="text-xs text-slate-500 mt-1">{m.note}</p>}
              {m.lastUpdated && <p className="text-xs text-slate-400 mt-1">Last updated {formatDateTime(m.lastUpdated)}</p>}
            </div>
            <StateBadge state={m.status} />
          </div>
        ))}
      </div>

      {(!cardEnabled || !achEnabled) && (
        <div className="mt-6 pt-6 border-t border-slate-100">
          <p className="text-sm text-slate-600 mb-2">Need to enable a payment method that isn't active yet?</p>
          <Link href="/merchant/support/tickets/new?category=PAYMENT" className="text-sm font-semibold text-blue-600 hover:underline">
            Request Enablement via Support
          </Link>
        </div>
      )}
    </div>
  );
}
