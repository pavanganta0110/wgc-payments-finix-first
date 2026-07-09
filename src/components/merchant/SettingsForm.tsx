"use client";

import { useState } from "react";
import toast from "react-hot-toast";

export default function SettingsForm({
  initialName,
  initialEmail,
}: {
  initialName: string;
  initialEmail: string;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/merchant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, primaryContactEmail: email }),
      });
      if (!res.ok) throw new Error("Failed to save");
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Organization Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#eab308]"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Primary Contact Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-[#eab308]"
        />
      </div>
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 rounded-xl bg-[#eab308] text-sm font-bold text-slate-900 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}
