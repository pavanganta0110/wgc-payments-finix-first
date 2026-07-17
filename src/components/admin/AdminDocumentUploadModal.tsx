'use client';

import { useState, useEffect, useRef } from 'react';

interface OrgResult {
  id: string;
  organizationName: string;
  contactName: string;
  contactEmail: string;
  status: string;
}

export default function AdminDocumentUploadModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OrgResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<OrgResult | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selected || query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/admin/onboarding-applications/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data) => setResults(data.applications || []))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query, selected]);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError('Select an organization first.');
      return;
    }
    if (!file) {
      setError('Select a file to upload.');
      return;
    }

    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('onboardingApplicationId', selected.id);
      formData.append('file', file);

      const res = await fetch('/api/admin/documents/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Upload failed.');
        return;
      }
      onUploaded();
      onClose();
    } catch {
      setError('Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-lg p-6 mt-16 sm:mt-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">Upload a document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-slate-500 mb-5">
          For a 501(c)(3) letter received outside the applicant's own onboarding flow (e.g. emailed to support). It will be attributed to your admin account.
        </p>

        <form onSubmit={handleUpload} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Organization</label>
            {selected ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 bg-slate-50">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selected.organizationName}</p>
                  <p className="text-xs text-slate-500">{selected.contactName} · {selected.contactEmail}</p>
                </div>
                <button type="button" onClick={() => { setSelected(null); setQuery(''); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search organization name, contact, or email…"
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-blue-400"
                />
                {searching && <p className="text-xs text-slate-400 mt-1">Searching…</p>}
                {results.length > 0 && (
                  <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {results.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => { setSelected(org); setResults([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50"
                      >
                        <p className="text-sm font-semibold text-slate-900">{org.organizationName}</p>
                        <p className="text-xs text-slate-500">{org.contactName} · {org.contactEmail}</p>
                      </button>
                    ))}
                  </div>
                )}
                {!searching && query.trim().length >= 2 && results.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1">No matching organizations.</p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-sm"
            />
            <p className="text-xs text-slate-400 mt-1">PDF, JPG, or PNG. Up to 10MB.</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={uploading || !selected || !file}
              className="px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800 disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload document'}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
