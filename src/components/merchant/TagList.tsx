"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import toast from "react-hot-toast";

export default function TagList({
  tags,
  onAdd,
  onRemove,
}: {
  tags: string[];
  onAdd?: (tag: string) => Promise<void> | void;
  onRemove?: (tag: string) => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submitAdd = async () => {
    const tag = value.trim();
    if (!tag || !onAdd) {
      setAdding(false);
      setValue("");
      return;
    }
    setBusy(true);
    try {
      await onAdd(tag);
      setValue("");
      setAdding(false);
    } catch {
      toast.error("Couldn't add tag. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600"
        >
          {tag}
          {onRemove && (
            <button onClick={() => onRemove(tag)} className="hover:text-slate-900">
              <X className="w-3 h-3" />
            </button>
          )}
        </span>
      ))}
      {onAdd &&
        (adding ? (
          <input
            autoFocus
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
            onBlur={submitAdd}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAdd();
              if (e.key === "Escape") {
                setValue("");
                setAdding(false);
              }
            }}
            className="px-2 py-0.5 rounded-full text-xs border border-slate-300 outline-none w-24"
          />
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border border-dashed border-slate-300 text-slate-500 hover:bg-slate-50"
          >
            <Plus className="w-3 h-3" />
            Add tag
          </button>
        ))}
      {tags.length === 0 && !onAdd && <span className="text-sm text-slate-400">No tags</span>}
    </div>
  );
}
