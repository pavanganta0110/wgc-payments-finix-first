"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Loader2, X } from "lucide-react";
import SettingsSaveBar from "@/components/merchant/SettingsSaveBar";
import { useUnsavedChangesWarning } from "@/lib/settings/useUnsavedChanges";

interface FormValues {
  logoUrl: string;
  faviconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

const inputClass = "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-slate-400";
const ALLOWED_LOGO_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer" />
        <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="#0B5DBC" />
      </div>
    </div>
  );
}

export default function BrandingSettingsForm({ initial }: { initial: FormValues }) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isDirty = JSON.stringify(values) !== JSON.stringify(initial);
  useUnsavedChangesWarning(isDirty);

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => setValues((v) => ({ ...v, [field]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/merchant/settings/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      toast.success("Branding saved");
      Object.assign(initial, values);
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed to save branding");
    } finally {
      setSaving(false);
    }
  };

  const handleLogoFileSelected = async (file: File | undefined) => {
    if (!file) return;
    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      toast.error("Only PNG, JPG, JPEG, SVG, and WEBP files are supported.");
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      toast.error("File too large. Maximum size is 5MB.");
      return;
    }

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/merchant/settings/branding/logo-upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to upload logo");
      }
      set("logoUrl", data.logoUrl);
      Object.assign(initial, { logoUrl: data.logoUrl });
      toast.success("Logo uploaded");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload logo");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    setUploadingLogo(true);
    try {
      const res = await fetch("/api/merchant/settings/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logoUrl: null }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove logo");
      }
      set("logoUrl", "");
      Object.assign(initial, { logoUrl: "" });
      toast.success("Logo removed");
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove logo");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Organization Logo</label>
        <p className="text-xs text-slate-400 mb-2">PNG, JPG, JPEG, SVG, or WEBP. Max 5MB.</p>
        {values.logoUrl && (
          <div className="mb-2 flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={values.logoUrl}
              alt="Logo preview"
              className="h-12 w-12 object-contain rounded-lg bg-white border border-slate-200"
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")}
            />
            <button
              type="button"
              onClick={removeLogo}
              disabled={uploadingLogo}
              className="flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline disabled:opacity-50"
            >
              <X className="w-3 h-3" /> Remove logo
            </button>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_LOGO_TYPES.join(",")}
          onChange={(e) => handleLogoFileSelected(e.target.files?.[0])}
          disabled={uploadingLogo}
          className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
        />
        {uploadingLogo && (
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" /> {values.logoUrl ? "Uploading…" : "Uploading…"}
          </p>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Favicon URL</label>
        <input className={inputClass} value={values.faviconUrl} onChange={(e) => set("faviconUrl", e.target.value)} placeholder="https://…" />
      </div>
      <ColorField label="Primary Color" value={values.primaryColor} onChange={(v) => set("primaryColor", v)} />
      <ColorField label="Secondary Color" value={values.secondaryColor} onChange={(v) => set("secondaryColor", v)} />
      <ColorField label="Accent Color" value={values.accentColor} onChange={(v) => set("accentColor", v)} />

      <SettingsSaveBar isDirty={isDirty} saving={saving} error={error} onSave={save} onReset={() => setValues(initial)} />
    </div>
  );
}
