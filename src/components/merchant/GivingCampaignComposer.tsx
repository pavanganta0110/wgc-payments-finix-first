"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, X, Search } from "lucide-react";

interface GivingLinkOption {
  id: string;
  internalName: string;
  publicTitle: string;
  status: string;
}

interface DonorOption {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
}

const MERGE_FIELDS = [
  { token: "{{firstName}}", label: "Donor first name" },
  { token: "{{churchName}}", label: "Your organization's name" },
  { token: "{{link}}", label: "Their personal giving link" },
];

export default function GivingCampaignComposer() {
  const router = useRouter();

  const [links, setLinks] = useState<GivingLinkOption[]>([]);
  const [givingLinkId, setGivingLinkId] = useState("");
  const [name, setName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBodyTemplate, setEmailBodyTemplate] = useState(
    "Hi {{firstName}},\n\n{{churchName}} would be grateful for your support. You can give securely here:\n{{link}}\n\nThank you!"
  );

  const [donorQuery, setDonorQuery] = useState("");
  const [donorResults, setDonorResults] = useState<DonorOption[]>([]);
  const [selectedDonors, setSelectedDonors] = useState<DonorOption[]>([]);
  const [searching, setSearching] = useState(false);

  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sendProgress, setSendProgress] = useState<{ sent: number; total: number } | null>(null);

  useEffect(() => {
    fetch("/api/merchant/giving-links")
      .then((res) => res.json())
      .then((data) => setLinks((data.links || []).filter((l: GivingLinkOption) => l.status === "ACTIVE")))
      .catch(() => toast.error("Failed to load giving links"));
  }, []);

  useEffect(() => {
    if (donorQuery.trim().length < 2) {
      const clear = setTimeout(() => setDonorResults([]), 0);
      return () => clearTimeout(clear);
    }
    const timeout = setTimeout(() => {
      setSearching(true);
      fetch(`/api/merchant/donors/search?q=${encodeURIComponent(donorQuery)}`)
        .then((res) => res.json())
        .then((data) => setDonorResults((data.donors || []).filter((d: DonorOption) => d.email)))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timeout);
  }, [donorQuery]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetch("/api/merchant/giving-campaigns/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailSubject, emailBodyTemplate }),
      })
        .then((res) => res.json())
        .then((data) => setPreview({ subject: data.subject, body: data.body }))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [emailSubject, emailBodyTemplate]);

  const addDonor = (donor: DonorOption) => {
    if (selectedDonors.some((d) => d.id === donor.id)) return;
    setSelectedDonors((prev) => [...prev, donor]);
    setDonorQuery("");
    setDonorResults([]);
  };

  const removeDonor = (id: string) => {
    setSelectedDonors((prev) => prev.filter((d) => d.id !== id));
  };

  const insertMergeField = (token: string) => {
    setEmailBodyTemplate((prev) => `${prev}${prev.endsWith(" ") || prev.length === 0 ? "" : " "}${token}`);
  };

  const createAndSend = async () => {
    if (!name.trim() || !givingLinkId || !emailSubject.trim() || !emailBodyTemplate.trim() || selectedDonors.length === 0) {
      toast.error("Fill in a name, giving link, subject, message, and at least one donor.");
      return;
    }
    setSubmitting(true);
    try {
      const createRes = await fetch("/api/merchant/giving-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          givingLinkId,
          emailSubject,
          emailBodyTemplate,
          donorIds: selectedDonors.map((d) => d.id),
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Failed to create campaign");

      const campaignId = createData.campaign.id;
      const total = createData.recipientCount;
      setSendProgress({ sent: 0, total });

      // Drives the same chunked-processing shape as bulkStatementJobs.ts —
      // keep calling send-chunk until the server says done.
      let done = false;
      while (!done) {
        const chunkRes = await fetch(`/api/merchant/giving-campaigns/${campaignId}/send-chunk`, { method: "POST" });
        const chunkData = await chunkRes.json();
        if (!chunkRes.ok) throw new Error(chunkData.error || "Failed to send");
        done = chunkData.done;
        setSendProgress({ sent: total - chunkData.remaining, total });
      }

      toast.success("Campaign sent");
      router.push(`/merchant/giving-campaigns/${campaignId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send campaign");
      setSubmitting(false);
      setSendProgress(null);
    }
  };

  if (sendProgress) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center max-w-md mx-auto">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400 mx-auto mb-4" />
        <p className="text-sm font-semibold text-slate-900 mb-1">Sending…</p>
        <p className="text-xs text-slate-500">
          {sendProgress.sent} of {sendProgress.total} sent
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-6">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Campaign Details</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Campaign Name (internal only)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Fall Giving Email Blast"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Giving Link</label>
              <select
                value={givingLinkId}
                onChange={(e) => setGivingLinkId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400"
              >
                <option value="">Select a giving link…</option>
                {links.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.internalName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-1">Recipients</h3>
          <p className="text-xs text-slate-500 mb-3">Only donors with an email on file can be added.</p>
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={donorQuery}
              onChange={(e) => setDonorQuery(e.target.value)}
              placeholder="Search donors by name or email…"
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400"
            />
            {searching && <Loader2 className="w-4 h-4 animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />}
            {donorResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {donorResults.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => addDonor(d)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex flex-col"
                  >
                    <span className="font-medium text-slate-800">{d.name || "Unnamed donor"}</span>
                    <span className="text-xs text-slate-500">{d.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {selectedDonors.length === 0 ? (
            <p className="text-xs text-slate-400">No donors added yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedDonors.map((d) => (
                <span key={d.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
                  {d.name || d.email}
                  <button onClick={() => removeDonor(d.id)}>
                    <X className="w-3 h-3 text-slate-400 hover:text-slate-700" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-3">{selectedDonors.length} donor{selectedDonors.length === 1 ? "" : "s"} selected</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-900 mb-3">Message</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Subject</label>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-500">Body</label>
                <div className="flex gap-1">
                  {MERGE_FIELDS.map((f) => (
                    <button
                      key={f.token}
                      type="button"
                      title={f.label}
                      onClick={() => insertMergeField(f.token)}
                      className="px-2 py-0.5 rounded-full bg-slate-100 text-[11px] font-mono text-slate-600 hover:bg-slate-200"
                    >
                      {f.token}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={emailBodyTemplate}
                onChange={(e) => setEmailBodyTemplate(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400 font-mono"
              />
            </div>
          </div>
        </div>

        <button
          onClick={createAndSend}
          disabled={submitting}
          className="w-full px-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? "Sending…" : `Send to ${selectedDonors.length || 0} Donor${selectedDonors.length === 1 ? "" : "s"}`}
        </button>
      </div>

      <div className="lg:sticky lg:top-6 self-start">
        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Live Preview</p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-[11px] text-slate-400">Subject</p>
              <p className="text-sm font-semibold text-slate-900">{preview?.subject || "—"}</p>
            </div>
            <div className="px-4 py-4">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{preview?.body || "—"}</p>
            </div>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Shown with sample data — each real recipient gets their own name and a unique tracked link.
          </p>
        </div>
      </div>
    </div>
  );
}
