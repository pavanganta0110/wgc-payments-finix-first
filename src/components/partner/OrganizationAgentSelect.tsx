"use client";

import { useState } from "react";

export default function OrganizationAgentSelect({ churchId, agentId, agentName, agents }: { churchId: string; agentId: string | null; agentName: string | null; agents: { id: string; name: string }[] }) {
  const [value, setValue] = useState(agentId ?? "");
  const [error, setError] = useState(false);

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setError(false);
    const res = await fetch(`/api/partner/organizations/${churchId}/agent`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: next || null }) });
    if (!res.ok) {
      setValue(previous);
      setError(true);
    }
  }

  return (
    <span>
      <select aria-label="Agent" value={value} onChange={(e) => change(e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1 text-sm">
        <option value="">(No agent)</option>
        {agentId && !agents.some((a) => a.id === agentId) && <option value={agentId}>{agentName} (turned off)</option>}
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>
      {error && <span className="ml-2 text-xs text-red-600">Not saved</span>}
    </span>
  );
}
