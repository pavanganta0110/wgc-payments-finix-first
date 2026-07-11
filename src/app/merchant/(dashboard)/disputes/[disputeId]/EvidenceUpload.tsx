"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Upload, FileText, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/formatCentralTime";

type EvidenceItem = {
  id: string;
  fileName: string;
  mimeType: string;
  uploadedByEmail: string | null;
  submittedAt: Date | null;
  createdAt: Date;
};

const MAX_FILES = 8;

export default function EvidenceUpload({
  disputeId,
  locked,
  evidence,
}: {
  disputeId: string;
  locked: boolean;
  evidence: EvidenceItem[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/merchant/disputes/${disputeId}/evidence`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");
      toast.success("Evidence uploaded");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmitResponse = async () => {
    if (evidence.length === 0) {
      toast.error("Upload at least one piece of evidence first.");
      return;
    }
    if (!window.confirm(`Submit ${evidence.length} evidence file${evidence.length === 1 ? "" : "s"} as your final response? This cannot be undone.`)) {
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/merchant/disputes/${disputeId}/submit`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Submission failed");
      toast.success("Response submitted");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {evidence.length === 0 ? (
        <p className="text-sm text-slate-500 mb-3">No evidence uploaded yet.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {evidence.map((item) => (
            <div key={item.id} className="flex items-center justify-between text-sm border border-slate-100 rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700 truncate">{item.fileName}</p>
                  <p className="text-xs text-slate-400">
                    {item.uploadedByEmail || "—"} · {formatDateTime(item.createdAt)}
                    {item.submittedAt && " · Submitted"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {locked ? (
        <p className="text-sm text-slate-500">
          Evidence submitted {formatDateTime(evidence.find((e) => e.submittedAt)?.submittedAt)} — locked from further edits.
        </p>
      ) : (
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={handleFileSelected}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || evidence.length >= MAX_FILES}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {uploading ? "Uploading..." : "Upload Evidence"}
          </button>
          <button
            onClick={handleSubmitResponse}
            disabled={submitting || evidence.length === 0}
            className="px-4 py-2 rounded-xl bg-[#eab308] text-[#010409] text-sm font-bold hover:bg-[#d4a106] disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Response"}
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400 mt-2">
        Up to {MAX_FILES} files, 1MB each (JPG, PNG, PDF). Submitting locks evidence from further changes.
      </p>
    </div>
  );
}
