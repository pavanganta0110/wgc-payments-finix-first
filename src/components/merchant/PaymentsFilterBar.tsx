"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import toast from "react-hot-toast";
import { Download, ListFilter, Bookmark, ChevronDown } from "lucide-react";
import DateRangePicker from "@/components/merchant/DateRangePicker";
import PillFilterInput from "@/components/merchant/PillFilterInput";

const STATES = ["SUCCEEDED", "FAILED", "PENDING", "CANCELED", "RETURNED"];

export default function PaymentsFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = searchParams.get("state") || "";
  const last4 = searchParams.get("last4") || "";
  const donorName = searchParams.get("buyer") || "";
  const [isStateOpen, setIsStateOpen] = useState(false);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`);
  };

  const stateLabel = state ? state.charAt(0) + state.slice(1).toLowerCase() : "State";

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <DateRangePicker />

      <div className="relative">
        <button
          onClick={() => setIsStateOpen((o) => !o)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full border text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 ${
            isStateOpen ? "border-slate-900" : "border-slate-200"
          }`}
        >
          {stateLabel}
          <ChevronDown
            className={`w-4 h-4 text-slate-400 transition-transform ${isStateOpen ? "rotate-180" : ""}`}
          />
        </button>
        {isStateOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsStateOpen(false)} />
            <div className="absolute left-0 mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-xl py-2 w-40">
              <button
                onClick={() => {
                  setParam("state", "");
                  setIsStateOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                All States
              </button>
              {STATES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setParam("state", s);
                    setIsStateOpen(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <PillFilterInput
        label="Last Four"
        value={last4}
        maxLength={4}
        width="w-48"
        placeholder="Payment instrument last 4 digits"
        onApply={(v) => setParam("last4", v)}
      />

      <PillFilterInput
        label="Donor Name"
        value={donorName}
        width="w-56"
        placeholder="Donor or payment instrument name"
        onApply={(v) => setParam("buyer", v)}
      />

      <div className="h-6 w-px bg-slate-200" />

      <button
        onClick={() => toast("More filters are coming soon.", { icon: "🚧" })}
        className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-slate-200 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50"
      >
        <ListFilter className="w-4 h-4" />
        Filters
      </button>

      <button
        onClick={() => toast("Saved views are coming soon.", { icon: "🚧" })}
        className="flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline"
      >
        <Bookmark className="w-4 h-4" />
        Save View
      </button>

      <a
        href={`/api/merchant/transactions/payments/export?${searchParams.toString()}`}
        className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Download className="w-4 h-4" />
        Export
      </a>
    </div>
  );
}
