"use client";

import { useEffect, useState } from "react";

interface Agent {
  id: string;
  name: string;
  email: string;
  disabled: boolean;
  organizations: number;
  link: string;
}

const inputClass = "rounded-lg border border-slate-200 px-3 py-2 text-sm";
const buttonClass = "rounded-lg bg-[#010409] text-white text-sm font-semibold px-4 py-2 disabled:opacity-60";

export default function PartnerAgentsPanel({ canEdit }: { canEdit: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetch("/api/partner/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => setMessage({ ok: false, text: "Couldn't load agents." }));
  }, [reloadKey]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/partner/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setMessage({ ok: false, text: data.error ?? "Couldn't add the agent." });
    setName("");
    setEmail("");
    setReloadKey((k) => k + 1);
  }

  async function setDisabled(id: string, disabled: boolean) {
    const res = await fetch(`/api/partner/agents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disabled }) });
    if (!res.ok) return setMessage({ ok: false, text: "Couldn't update the agent." });
    setReloadKey((k) => k + 1);
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setMessage({ ok: true, text: "Link copied." });
    } catch {
      setMessage({ ok: false, text: "Couldn't copy. Select the link and copy it by hand." });
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <form onSubmit={add} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex flex-wrap gap-3 items-end">
          <div>
            <label htmlFor="agent-name" className="block text-xs font-semibold text-slate-600 mb-1">Name</label>
            <input id="agent-name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label htmlFor="agent-email" className="block text-xs font-semibold text-slate-600 mb-1">Email</label>
            <input id="agent-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`${inputClass} w-64`} />
          </div>
          <button type="submit" className={buttonClass}>Add agent</button>
        </form>
      )}
      <p className="text-xs text-slate-500">
        Each agent has their own Get Started link. An organization that applies through it is tagged to that agent, and the agent gets a copy of that organization&apos;s boarding status emails. Agents do not sign in.
      </p>
      {message && <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`} role="status">{message.text}</p>}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-100">
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold text-right">Organizations</th>
              <th className="px-4 py-3 font-semibold">Get Started link</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-slate-500">No agents yet.</td></tr>
            )}
            {agents.map((a) => (
              <tr key={a.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-3 text-slate-900">
                  <span className="font-semibold">{a.name}</span>
                  <span className="text-slate-500"> · {a.email}</span>
                  {a.disabled && <span className="ml-2 text-xs text-slate-500">(turned off)</span>}
                </td>
                <td className="px-4 py-3 text-right text-slate-900">{a.organizations}</td>
                <td className="px-4 py-3">
                  {a.disabled ? <span className="text-slate-400">—</span> : (
                    <button type="button" onClick={() => copy(a.link)} className="text-xs font-semibold text-slate-700 underline">Copy link</button>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {canEdit && (
                    <button type="button" onClick={() => setDisabled(a.id, !a.disabled)} className="text-xs font-semibold text-red-600">
                      {a.disabled ? "Turn on" : "Turn off"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
