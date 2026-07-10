"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Download, ChevronDown, RefreshCw } from "lucide-react";
import DateRangePicker from "@/components/merchant/DateRangePicker";
import toast from "react-hot-toast";

function titleCase(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default function AuthorizationFilterBar({
  states,
  exportHref,
  syncHref,
}: {
  states: string[];
  exportHref?: string;
  syncHref?: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const state = searchParams.get("state") || "";
  const buyer = searchParams.get("buyer") || "";
  const last4 = searchParams.get("last4") || "";
  const [isStateOpen, setIsStateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const setParam = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("id");
    router.push(`?${params.toString()}`);
  };

  const stateLabel = state ? titleCase(state) : "Status";

  const handleSync = async () => {
    if (!syncHref || syncing) return;
    setSyncing(true);
    try {
      const res = await fetch(syncHref, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Sync failed");
      } else {
        toast.success(`Sync complete: ${data.created} created, ${data.updated} updated`);
        router.refresh();
      }
    } catch {
      toast.error("Sync failed — please try again");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-3 mb-4 flex-wrap">
      <DateRangePicker />

      {/* State filter */}
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
            <div className="absolute left-0 mt-2 z-50 bg-white rounded-2xl border border-slate-200 shadow-xl py-2 w-44">
              <button
                onClick={() => { setParam("state", ""); setIsStateOpen(false); }}
                className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                All Statuses
              </button>
              {states.map((s) => (
                <button
                  key={s}
                  onClick={() => { setParam("state", s); setIsStateOpen(false); }}
                  className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {titleCase(s)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Buyer search */}
      <input
        type="text"
        placeholder="Buyer name"
        value={buyer}
        onChange={(e) => setParam("buyer", e.target.value)}
        className="px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-700 bg-white outline-none w-40"
      />

      {/* Last4 search */}
      <input
        type="text"
        placeholder="Last 4"
        value={last4}
        maxLength={4}
        onChange={(e) => setParam("last4", e.target.value.replace(/\D/g, ""))}
        className="px-4 py-2 rounded-full border border-slate-200 text-sm text-slate-700 bg-white outline-none w-24"
      />

      <div className="ml-auto flex items-center gap-2">
        {syncHref && (
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from Finix"}
          </button>
        )}

        {exportHref && (
          <a
            href={`${exportHref}?${searchParams.toString()}`}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Download className="w-4 h-4" />
            Export
          </a>
        )}
      </div>
    </div>
  );
}
