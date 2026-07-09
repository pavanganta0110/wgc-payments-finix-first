"use client";

import toast from "react-hot-toast";
import { ChevronUp, ChevronDown, MoreHorizontal, Pin } from "lucide-react";

function showComingSoon(feature: string) {
  toast(`${feature} is coming soon.`, { icon: "🚧" });
}

export function PanelNavArrows() {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => showComingSoon("Row navigation")}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
      >
        <ChevronUp className="w-4 h-4" />
      </button>
      <button
        onClick={() => showComingSoon("Row navigation")}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
      >
        <ChevronDown className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ViewAllDetailsButton() {
  return (
    <button
      onClick={() => showComingSoon("Full payment details page")}
      className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"
    >
      View All Details
    </button>
  );
}

export function PaymentMoreMenu() {
  return (
    <button
      onClick={() => showComingSoon("More actions")}
      className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
    >
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
}

export function PinButton() {
  return (
    <button
      onClick={() => showComingSoon("Pinning")}
      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
    >
      <Pin className="w-4 h-4" />
    </button>
  );
}

export function ComingSoonAction({
  label,
  feature,
  className,
}: {
  label: string;
  feature: string;
  className?: string;
}) {
  return (
    <button onClick={() => showComingSoon(feature)} className={className}>
      {label}
    </button>
  );
}
