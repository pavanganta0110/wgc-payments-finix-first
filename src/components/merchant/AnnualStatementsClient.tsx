"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { formatCents } from "@/lib/format";
import StateBadge from "@/components/merchant/StateBadge";

interface Row {
  donorId: string;
  donorName: string;
  donorEmail: string | null;
  donationCount: number;
  recordedTotalCents: number;
  statementId: string | null;
  statementStatus: string;
  deliveryStatus: string;
  generatedAt: string | null;
  sentAt: string | null;
  hasMissingInfo: boolean;
}

interface Summary {
  eligibleDonors: number;
  statementsGenerated: number;
  statementsSent: number;
  statementsPendingReview: number;
  missingEmail: number;
  failedDelivery: number;
  totalRecordedDonationsCents: number;
}

const currentYear = new Date().getFullYear();

export default function AnnualStatementsClient() {
  const [year, setYear] = useState(currentYear - 1);
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/merchant/donors/annual-statements?year=${year}`);
      const data = await res.json();
      setRows(data.rows ?? []);
      setSummary(data.summary ?? null);
      setSelected(new Set());
    } catch {
      toast.error("Failed to load annual statements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const toggleAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.donorId)));
  };
  const toggleOne = (donorId: string) => {
    const next = new Set(selected);
    if (next.has(donorId)) next.delete(donorId);
    else next.add(donorId);
    setSelected(next);
  };

  const generateSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/donors/annual-statements/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear: year, donorIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      toast.success(`Generated ${data.generated} statement(s)${data.needsReview ? ` (${data.needsReview} need review)` : ""}${data.failed ? `, ${data.failed} failed` : ""}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate statements");
    } finally {
      setBusy(false);
    }
  };

  const generateAllEligible = async () => {
    setSelected(new Set(rows.map((r) => r.donorId)));
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/donors/annual-statements/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear: year, donorIds: rows.map((r) => r.donorId) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      toast.success(`Generated ${data.generated} statement(s)`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate statements");
    } finally {
      setBusy(false);
    }
  };

  const sendSelected = async () => {
    const statementIds = rows.filter((r) => selected.has(r.donorId) && r.statementId).map((r) => r.statementId!) as string[];
    if (statementIds.length === 0) {
      toast.error("Generate statements before sending");
      return;
    }
    if (!window.confirm(`Send ${statementIds.length} statement(s) by email? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/merchant/donors/annual-statements/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      toast.success(`Sent ${data.sent}${data.failed ? `, ${data.failed} failed` : ""}${data.skippedNeedsReview ? `, ${data.skippedNeedsReview} need review` : ""}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to send statements");
    } finally {
      setBusy(false);
    }
  };

  const generateOne = async (donorId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/merchant/donors/${donorId}/statements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxYear: year }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate");
      toast.success("Statement generated");
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate statement");
    } finally {
      setBusy(false);
    }
  };

  const sendOne = async (donorId: string, statementId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/merchant/donors/${donorId}/statements/${statementId}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send");
      toast.success(`Sent to ${data.recipientEmail}`);
      await load();
    } catch (err: any) {
      toast.error(err.message || "Failed to send statement");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-lg font-bold text-slate-900">Annual Donation Statements</h2>
        <select value={year} onChange={(e) => setYear(parseInt(e.target.value, 10))} className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm outline-none">
          {Array.from({ length: 6 }).map((_, i) => {
            const y = currentYear - i;
            return <option key={y} value={y}>{y}</option>;
          })}
        </select>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
          {[
            ["Eligible Donors", summary.eligibleDonors],
            ["Statements Generated", summary.statementsGenerated],
            ["Statements Sent", summary.statementsSent],
            ["Pending Review", summary.statementsPendingReview],
            ["Missing Email", summary.missingEmail],
            ["Failed Delivery", summary.failedDelivery],
            ["Total Recorded", formatCents(summary.totalRecordedDonationsCents)],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-3">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className="text-lg font-bold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <button onClick={generateSelected} disabled={busy || selected.size === 0} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50">
          Generate for Selected ({selected.size})
        </button>
        <button onClick={generateAllEligible} disabled={busy || rows.length === 0} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Generate for All Eligible
        </button>
        <button onClick={sendSelected} disabled={busy || selected.size === 0} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          Send to Selected
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        {loading ? (
          <p className="px-6 py-10 text-center text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <h3 className="text-sm font-bold text-slate-900 mb-1">No eligible donors</h3>
            <p className="text-sm text-slate-500">No donors have qualifying completed donations for {year}.</p>
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1200px]">
            <thead>
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide bg-slate-50">
                <th className="px-4 py-3"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={toggleAll} /></th>
                <th className="px-4 py-3">Donor</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3 text-right">Donations</th>
                <th className="px-4 py-3 text-right">Recorded Total</th>
                <th className="px-4 py-3">Statement Status</th>
                <th className="px-4 py-3">Delivery Status</th>
                <th className="px-4 py-3">Sent At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.donorId} className="border-t border-slate-50">
                  <td className="px-4 py-3"><input type="checkbox" checked={selected.has(r.donorId)} onChange={() => toggleOne(r.donorId)} /></td>
                  <td className="px-4 py-3">
                    <Link href={`/merchant/donors/${r.donorId}`} className="font-semibold text-slate-800 hover:underline">{r.donorName}</Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.donorEmail || <span className="text-amber-600">Missing</span>}</td>
                  <td className="px-4 py-3 text-right text-slate-600">{r.donationCount}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">{formatCents(r.recordedTotalCents)}</td>
                  <td className="px-4 py-3"><StateBadge state={r.statementStatus} /></td>
                  <td className="px-4 py-3"><StateBadge state={r.deliveryStatus} /></td>
                  <td className="px-4 py-3 text-slate-500">{r.sentAt ? new Date(r.sentAt).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {!r.statementId ? (
                        <button onClick={() => generateOne(r.donorId)} disabled={busy} className="text-xs font-semibold text-blue-600 hover:underline">Generate</button>
                      ) : (
                        <>
                          <a href={`/api/merchant/donors/${r.donorId}/statements/${r.statementId}/download`} className="text-xs font-semibold text-blue-600 hover:underline">Download</a>
                          {r.statementStatus !== "NEEDS_REVIEW" && (
                            <button onClick={() => sendOne(r.donorId, r.statementId!)} disabled={busy} className="text-xs font-semibold text-blue-600 hover:underline">
                              {r.sentAt ? "Resend" : "Send"}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
