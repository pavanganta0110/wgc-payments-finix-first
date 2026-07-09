"use client";

import toast from "react-hot-toast";

export default function PaymentsHeaderActions() {
  const showComingSoon = (feature: string) => {
    toast(`${feature} is coming soon.`, { icon: "🚧" });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => showComingSoon("Payment Links")}
        className="px-4 py-2 rounded-xl border border-blue-200 text-sm font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
      >
        Create a Payment Link
      </button>
      <button
        onClick={() => showComingSoon("Take a Payment")}
        className="px-4 py-2 rounded-xl bg-blue-600 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
      >
        Take a Payment
      </button>
    </div>
  );
}
