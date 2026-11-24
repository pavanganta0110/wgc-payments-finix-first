"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import CardBrandLogo from "@/components/merchant/CardBrandLogo";
import { CARD_THEMES, type InstrumentPanelProps, type InstrumentRow, type PillTone } from "@/lib/finix/cardDisplay";

const PILL: Record<PillTone, string> = {
  good: "bg-green-50 text-green-700",
  warn: "bg-amber-50 text-amber-700",
  neutral: "bg-slate-100 text-slate-600",
};

function Row({ row }: { row: InstrumentRow }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-t border-slate-100 text-sm first:border-t-0">
      <span className="text-slate-500">{row.label}</span>
      {row.tone ? (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold text-right ${PILL[row.tone]}`}>{row.value}</span>
      ) : (
        <span className="flex items-center gap-2 font-semibold text-slate-800 text-right">
          {row.check && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600" aria-hidden="true">
              <Check className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
          )}
          {row.prefix && <span aria-hidden="true">{row.prefix}</span>}
          {row.value}
        </span>
      )}
    </div>
  );
}

/** The Payment Instrument card on a payment's detail page: a brand-tinted card graphic, then the checks. */
export default function PaymentInstrumentPanel(props: InstrumentPanelProps) {
  const [open, setOpen] = useState(false);
  const theme = CARD_THEMES[props.brand];

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h3 className="text-sm font-bold text-slate-900 mb-4">Payment Instrument</h3>

      <div
        className="relative w-full max-w-[380px] aspect-[5/3] rounded-[22px] overflow-hidden p-5 flex flex-col justify-between"
        style={{ background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`, boxShadow: `0 8px 24px ${theme.shadow}`, color: theme.ink }}
      >
        <div className="absolute -right-20 -top-16 h-72 w-72 rounded-full bg-white/30" aria-hidden="true" />
        <div className="relative flex items-center justify-between">
          <CardBrandLogo brand={props.brand} height={26} />
          {props.kindLabel && <span className="text-sm font-semibold" style={{ color: theme.sub }}>{props.kindLabel}</span>}
        </div>
        <div className="relative">
          {props.holder && (
            <div className="text-lg font-semibold mb-3 truncate" style={{ color: theme.ink }}>{props.holder}</div>
          )}
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold tracking-wider tabular-nums">{props.number}</span>
            {props.expiry && <span className="text-sm font-medium tabular-nums" style={{ color: theme.sub }}>{props.expiry}</span>}
          </div>
        </div>
      </div>

      <div className="mt-5">
        {props.rows.map((row) => (
          <Row key={row.label} row={row} />
        ))}
        {open && props.moreRows.map((row) => <Row key={row.label} row={row} />)}
      </div>

      {props.moreRows.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-800"
        >
          {open ? "Show less" : "Show more"}
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      )}
    </div>
  );
}
