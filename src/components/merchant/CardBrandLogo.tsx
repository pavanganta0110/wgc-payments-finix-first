"use client";

import { useState } from "react";
import { CARD_BRAND_LABEL, type CardBrandKey } from "@/lib/finix/cardDisplay";

/**
 * The card network's own logo, read from /public/card-brands/<brand>.svg (visa, mastercard,
 * discover, amex). Until a file is there, or for a brand with no logo, it shows the brand name as
 * plain text instead of a broken image. No logo is drawn here: the official files are dropped in.
 */
export default function CardBrandLogo({ brand, height = 28, className, label: labelOverride }: { brand: CardBrandKey; height?: number; className?: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  const label = labelOverride || CARD_BRAND_LABEL[brand];
  if (brand === "other" || failed) {
    return <span className={`font-bold tracking-tight ${className ?? ""}`} style={{ fontSize: Math.round(height * 0.55) }}>{label}</span>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/card-brands/${brand}.svg`} alt={label} height={height} style={{ height, width: "auto" }} className={className} onError={() => setFailed(true)} />
  );
}
