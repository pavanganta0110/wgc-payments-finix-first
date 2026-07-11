const STATE_STYLES: Record<string, string> = {
  SUCCEEDED: "bg-green-50 text-green-700",
  FAILED: "bg-red-50 text-red-700",
  PENDING: "bg-amber-50 text-amber-700",
  CANCELED: "bg-slate-100 text-slate-600",
  REFUNDED: "bg-amber-50 text-amber-700",
  PARTIALLY_REFUNDED: "bg-amber-50 text-amber-700",
  REFUND_PENDING: "bg-amber-50 text-amber-700",
  // Disputes (FinixDispute.state / displayStatus)
  WON: "bg-green-50 text-green-700",
  LOST: "bg-red-50 text-red-700",
  EXPIRED: "bg-slate-100 text-slate-600",
  // Settlements
  ACCRUING: "bg-amber-50 text-amber-700",
  SETTLED: "bg-green-50 text-green-700",
};

export default function StateBadge({ state }: { state: string | null | undefined }) {
  const s = (state || "UNKNOWN").toUpperCase();
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        STATE_STYLES[s] || "bg-slate-100 text-slate-600"
      }`}
    >
      {s.replace(/_/g, " ")}
    </span>
  );
}
