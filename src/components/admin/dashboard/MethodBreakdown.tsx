"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Card, { EmptyNote } from "@/components/merchant/reporting/overview/Card";
import { SERIES } from "@/components/merchant/reporting/overview/tokens";
import { formatCents, percent } from "@/components/merchant/reporting/overview/format";

export interface BreakdownRow {
  key: string;
  label: string;
  hint: string;
  amountCents: number;
  count: number;
  /** Card network split (Visa, Mastercard, …) shown under the row; only set for card types. */
  brands?: { brand: string; amountCents: number; count: number }[];
}

type View = "methods" | "card";

const BRAND_LABELS: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMERICAN_EXPRESS: "American Express",
  AMEX: "American Express",
  DISCOVER: "Discover",
  DINERS_CLUB: "Diners Club",
  JCB: "JCB",
  UNKNOWN: "Brand not reported",
};
const brandLabel = (b: string) =>
  BRAND_LABELS[b] ?? b.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const COLOR: Record<string, string> = {
  CARD: SERIES.indigo,
  ACH: SERIES.teal,
  OTHER: SERIES.other,
  CREDIT: SERIES.indigo,
  DEBIT: "#0284C7",
  PREPAID: SERIES.amber,
  UNKNOWN: SERIES.other,
};

function Bar({ rows, total }: { rows: BreakdownRow[]; total: number }) {
  return (
    <div
      className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
      role="img"
      aria-label={rows.map((r) => `${r.label} ${percent((r.amountCents / total) * 100)}`).join(", ")}
    >
      {rows
        .filter((r) => r.amountCents > 0)
        .map((r) => (
          <div
            key={r.key}
            style={{ width: `${(r.amountCents / total) * 100}%`, background: COLOR[r.key] }}
            className="transition-[width] duration-300 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
          />
        ))}
    </div>
  );
}

function Rows({ rows, total, drillKey, onDrill }: { rows: BreakdownRow[]; total: number; drillKey?: string; onDrill?: () => void }) {
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  return (
    <ul className="mt-4 space-y-1">
      {rows.map((r) => {
        const share = total > 0 ? (r.amountCents / total) * 100 : 0;
        const countShare = totalCount > 0 ? (r.count / totalCount) * 100 : 0;
        const drillable = r.key === drillKey && r.amountCents > 0;
        const inner = (
          <>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: COLOR[r.key] }} aria-hidden />
            <span className="min-w-0 text-left">
              <span className="block font-medium text-slate-700">{r.label}</span>
              <span className="block text-xs text-slate-500">
                {r.count.toLocaleString("en-US")} payment{r.count === 1 ? "" : "s"}{" "}
                <span className="font-semibold text-slate-600" title="Share of the number of payments">
                  ({percent(countShare)})
                </span>{" "}
                · {r.hint}
              </span>
            </span>
            <span className="ml-auto font-bold tabular-nums text-slate-900">{formatCents(r.amountCents)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-500" title="Share of the dollar volume">
              {percent(share)}
            </span>
            {drillable && <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-indigo-600" aria-hidden />}
          </>
        );
        return (
          <li key={r.key}>
            {drillable ? (
              <button
                type="button"
                onClick={onDrill}
                aria-label={`${r.label}: show credit vs debit`}
                className="group flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-sm outline-none transition hover:bg-indigo-50/60 focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none"
              >
                {inner}
              </button>
            ) : (
              <div className={`flex w-full items-center gap-2.5 px-2 py-2 text-sm ${r.amountCents === 0 ? "opacity-60" : ""}`}>{inner}</div>
            )}
            {r.brands && r.brands.length > 0 && (
              <ul className="mb-2 ml-7 mr-2 space-y-0.5 border-l border-slate-100 pl-3">
                {r.brands.map((b) => (
                  <li key={b.brand} className="flex items-baseline gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-600">{brandLabel(b.brand)}</span>
                    <span>
                      {b.count.toLocaleString("en-US")} payment{b.count === 1 ? "" : "s"}
                    </span>
                    <span className="ml-auto tabular-nums text-slate-700">{formatCents(b.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      <li className="px-2 pt-2 text-xs text-slate-500">
        Percentage in brackets = share of the number of payments. Percentage on the right = share of the dollar amount.
      </li>
    </ul>
  );
}

export interface FeeCover {
  /** Successful payments where the donor chose to cover the processing fee. */
  donor: number;
  /** Successful payments where the donor didn't (the organization paid the fee). */
  org: number;
  /** Charges with no WGC payment record, so who paid the fee isn't known — left out of the percentages. */
  noRecord: number;
  /** Fee dollars donors covered, per Finix's supplemental fee rows. */
  donorCoveredCents: number;
}

/** Overall split of who covered the processing fee, across every merchant in the period. */
function FeeCoverSplit({ feeCover }: { feeCover: FeeCover }) {
  const known = feeCover.donor + feeCover.org;
  if (known === 0) return null;
  const donorShare = (feeCover.donor / known) * 100;
  const orgShare = (feeCover.org / known) * 100;
  const line = (color: string, label: string, count: number, share: number, extra?: string) => (
    <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} aria-hidden />
      <span className="min-w-0 text-left">
        <span className="block font-medium text-slate-700">{label}</span>
        <span className="block text-xs text-slate-500">
          {count.toLocaleString("en-US")} payment{count === 1 ? "" : "s"}
          {extra ? ` · ${extra}` : ""}
        </span>
      </span>
      <span className="ml-auto w-12 text-right font-bold tabular-nums text-slate-900">{percent(share)}</span>
    </div>
  );
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <h5 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Who covered the processing fee</h5>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={`Donor covered the fee ${percent(donorShare)}, didn't cover ${percent(orgShare)}`}
      >
        {feeCover.donor > 0 && <div style={{ width: `${donorShare}%`, background: "#059669" }} className="first:rounded-l-full last:rounded-r-full" />}
        {feeCover.org > 0 && <div style={{ width: `${orgShare}%`, background: "#94A3B8" }} className="first:rounded-l-full last:rounded-r-full" />}
      </div>
      <div className="mt-2 space-y-0.5">
        {line("#059669", "Donor covered the fee", feeCover.donor, donorShare, feeCover.donorCoveredCents > 0 ? `${formatCents(feeCover.donorCoveredCents)} in fees` : undefined)}
        {line("#94A3B8", "Donor didn't cover it (organization paid)", feeCover.org, orgShare)}
      </div>
      {feeCover.noRecord > 0 && (
        <p className="mt-1 px-2 text-xs text-slate-400">
          Out of payments with a WGC record; {feeCover.noRecord.toLocaleString("en-US")} charge{feeCover.noRecord === 1 ? "" : "s"} made outside WGC
          (e.g. in the Finix dashboard) {feeCover.noRecord === 1 ? "is" : "are"} not counted.
        </p>
      )}
    </div>
  );
}

export default function MethodBreakdown({
  methods,
  cardTypes,
  periodLabel,
  feeCover,
}: {
  methods: BreakdownRow[];
  cardTypes: BreakdownRow[];
  periodLabel: string;
  feeCover?: FeeCover;
}) {
  const [view, setView] = useState<View>("methods");
  const methodTotal = methods.reduce((s, r) => s + r.amountCents, 0);
  const cardTotal = cardTypes.reduce((s, r) => s + r.amountCents, 0);
  const visibleMethods = methods.filter((r) => r.key !== "OTHER" || r.amountCents > 0);
  const visibleCardTypes = cardTypes.filter((r) => (r.key !== "PREPAID" && r.key !== "UNKNOWN") || r.amountCents > 0);
  const credit = cardTypes.find((r) => r.key === "CREDIT")?.amountCents ?? 0;
  const debit = cardTypes.find((r) => r.key === "DEBIT")?.amountCents ?? 0;

  const tabs: [View, string][] = [
    ["methods", "Card vs ACH"],
    ["card", "Credit vs debit"],
  ];

  return (
    <Card
      title={view === "methods" ? "Payment methods" : "Card payments by card type"}
      subtitle={view === "methods" ? `${periodLabel} · select Card for credit vs debit` : `${periodLabel} · ${formatCents(cardTotal)} on cards`}
      action={
        <div role="radiogroup" aria-label="Breakdown" className="flex shrink-0 rounded-lg bg-slate-100 p-0.5">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={view === k}
              onClick={() => setView(k)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold outline-none transition motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                view === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {view === "methods" ? (
        methodTotal === 0 ? (
          <EmptyNote title="Nothing processed in this period" body="Card and ACH volume across every merchant will be split out here." />
        ) : (
          <>
            <Bar rows={visibleMethods} total={methodTotal} />
            <Rows rows={visibleMethods} total={methodTotal} drillKey="CARD" onDrill={() => setView("card")} />
            {feeCover && <FeeCoverSplit feeCover={feeCover} />}
          </>
        )
      ) : (
        <>
          <button
            type="button"
            onClick={() => setView("methods")}
            className="-mt-1 mb-3 inline-flex items-center gap-1 rounded text-xs font-semibold text-indigo-600 outline-none hover:text-indigo-800 focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            All payment methods
          </button>
          {cardTotal === 0 ? (
            <EmptyNote title="No card payments in this period" body="Credit, debit and prepaid card volume will show here." />
          ) : (
            <>
              <Bar rows={visibleCardTypes} total={cardTotal} />
              <Rows rows={visibleCardTypes} total={cardTotal} />
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                {credit + debit === 0 ? (
                  "Card type hasn't synced from Finix for these payments yet."
                ) : (
                  <>
                    <span className="font-semibold text-slate-700">{credit >= debit ? "Credit" : "Debit"}</span> cards carry{" "}
                    {percent((Math.max(credit, debit) / cardTotal) * 100)} of card volume. Card type comes from Finix&apos;s
                    payment-instrument record.
                  </>
                )}
              </p>
            </>
          )}
        </>
      )}
    </Card>
  );
}
