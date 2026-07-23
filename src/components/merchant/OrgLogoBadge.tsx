"use client";

import { useState } from "react";

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Square logo badge for the merchant dashboard header — shows the
 * organization's uploaded logo (object-contain, centered) or, if none is
 * set or the URL fails to load, a fallback of the organization's initials.
 * Never renders a broken-image icon. */
export default function OrgLogoBadge({ logoUrl, orgName }: { logoUrl: string | null; orgName: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(logoUrl) && !failed;

  return (
    <div className="w-10 h-10 shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl!}
          alt={`${orgName} logo`}
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-xs font-bold text-slate-500">{initialsFor(orgName)}</span>
      )}
    </div>
  );
}
