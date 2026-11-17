"use client";

import { useState } from "react";

const inputClass = "rounded-lg border border-slate-200 px-3 py-2 text-sm";
const linkClass = "inline-block rounded-lg bg-[#010409] text-white text-sm font-semibold px-4 py-2";

/** First and last day (YYYY-MM-DD) of last calendar month, the usual commission period. */
function lastMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export default function PartnerReportsPanel() {
  const initial = lastMonth();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const valid = Boolean(from && to && from <= to);
  const href = (type: string) => `/api/partner/reports?type=${type}&from=${from}&to=${to}`;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="report-from" className="block text-xs font-semibold text-slate-600 mb-1">From</label>
          <input id="report-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label htmlFor="report-to" className="block text-xs font-semibold text-slate-600 mb-1">To (included)</label>
          <input id="report-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </div>
      </div>
      {!valid && <p className="text-sm text-red-600">Pick a start date that is not after the end date.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
          <h3 className="font-bold text-slate-900">By agent</h3>
          <p className="text-sm text-slate-600">One row per agent: organizations, how many were boarded in the period, card and ACH volume, refunds, ACH returns, and the fee WGC charged.</p>
          {valid ? <a className={linkClass} href={href("agents")}>Download CSV</a> : <span className={`${linkClass} opacity-50`}>Download CSV</span>}
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
          <h3 className="font-bold text-slate-900">By organization</h3>
          <p className="text-sm text-slate-600">One row per organization with its agent, boarded date, and the same figures, so each agent&apos;s total can be traced.</p>
          {valid ? <a className={linkClass} href={href("organizations")}>Download CSV</a> : <span className={`${linkClass} opacity-50`}>Download CSV</span>}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Volume is successful card and ACH payments in the period; refunds and ACH returns are those that happened in the period. These reports do not include Finix&apos;s costs or residuals, which are only known per month for the whole platform.
        Organizations with no agent are listed as &quot;(No agent)&quot;; set an agent on the Organizations page.
      </p>
    </div>
  );
}
