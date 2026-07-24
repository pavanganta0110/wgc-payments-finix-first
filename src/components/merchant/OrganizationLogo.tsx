"use client";

import { useState } from "react";

interface OrganizationLogoProps {
  logoUrl: string | null;
  churchName: string;
  mode: "main" | "embed";
}

export default function OrganizationLogo({ logoUrl, churchName, mode }: OrganizationLogoProps) {
  const [hasError, setHasError] = useState(false);

  if (!logoUrl || hasError) {
    return null; // Hide completely on failure, do not show alt text or broken icon
  }

  return (
    <div className={`flex justify-center ${mode === "main" ? "mb-6" : "mb-4"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl}
        alt="" // Deliberately empty so no fallback text is shown if image fails before onError triggers
        onError={() => setHasError(true)}
        style={{
          width: "auto",
          height: "auto",
          maxWidth: mode === "main" ? "220px" : "180px",
          maxHeight: mode === "main" ? "80px" : "64px",
          objectFit: "contain",
          margin: "0 auto",
        }}
      />
    </div>
  );
}
