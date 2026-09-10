"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquare } from "lucide-react";
import StateBadge from "@/components/merchant/StateBadge";

interface SmsAddonPlan {
  code: string;
  name: string;
  monthlyAmountCents: number;
  includedTexts: number;
  overageRateCents: number;
}

interface SmsAddonStatus {
  active: boolean;
  subscription: { planCode: string; status: string; includedTexts: number; monthlyAmountCents: number; overageRateCents: number } | null;
  usage: { textsSent: number; billingPeriod: string };
  plans: SmsAddonPlan[];
  canManageSubscription: boolean;
}

function cents(n: number) {
  return `$${(n / 100).toFixed(2)}`;
}

export default function SmsAddonCard() {
  const [status, setStatus] = useState<SmsAddonStatus | null>(null);
  const [subscribing, setSubscribing] = useState<string | null>(null);

  const load = () => {
    fetch("/api/merchant/sms-addon")
      .then((res) => res.json())
      .then(setStatus)
      .catch(() => {});
  };
  useEffect(load, []);

  const subscribe = async (planCode: string) => {
    setSubscribing(planCode);
    try {
      const res = await fetch("/api/merchant/sms-addon/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to subscribe");
      toast.success("Text messaging is active — you can send texts right away.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to subscribe");
    } finally {
      setSubscribing(null);
    }
  };

  if (!status) return null;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-slate-400" />
          <h3 className="text-sm font-bold text-slate-900">Text Messaging Add-on</h3>
        </div>
        {status.subscription && <StateBadge state={status.subscription.status} />}
      </div>

      {status.active && status.subscription ? (
        <>
          <div className="grid grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Plan</p>
              <p className="font-semibold text-slate-800">{cents(status.subscription.monthlyAmountCents)}/mo — {status.subscription.includedTexts} texts included</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">This month&rsquo;s usage</p>
              <p className="font-semibold text-slate-800">
                {status.usage.textsSent} / {status.subscription.includedTexts} texts
              </p>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Texts beyond your included allowance are billed at {cents(status.subscription.overageRateCents)}/text — nothing is blocked
            mid-campaign, overage is reviewed and billed after the month closes.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-slate-500 mb-4">
            Subscribe to send Giving Campaigns and individual giving-link shares by text message. Activates immediately — no separate
            payment setup, it bills to the payment method already on file for your WGC platform subscription.
          </p>
          {status.canManageSubscription ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {status.plans.map((plan) => (
                <div key={plan.code} className="border border-slate-200 rounded-xl p-4">
                  <p className="text-sm font-bold text-slate-900">{plan.name}</p>
                  <p className="text-xs text-slate-500 mt-1 mb-3">
                    {cents(plan.monthlyAmountCents)}/mo — {plan.includedTexts} texts included, then {cents(plan.overageRateCents)}/text
                  </p>
                  <button
                    onClick={() => subscribe(plan.code)}
                    disabled={subscribing !== null}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {subscribing === plan.code ? "Activating…" : "Subscribe"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Only your organization owner can subscribe to add-ons.</p>
          )}
        </>
      )}
    </div>
  );
}
