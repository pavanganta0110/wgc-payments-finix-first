/**
 * Parses a Finix Verification resource's `outcomes` array into a
 * human-readable, "<br/>"-joined requested-items string.
 *
 * Confirmed against a real production Verification response
 * (2026-09-04, Lighthouse Baptist Church): each outcome carries an
 * `outcome_message` field — the actual underwriter-written note (e.g.
 * "The correct MCC for a religious entity is 8661. Please update the
 * MCC.") — which is what the merchant needs to understand and act on.
 * This is a *different* field from `outcome_code` (e.g.
 * "INVALID_BUSINESS_MCC", a machine-oriented category), which the
 * earlier version of this function used exclusively — the merchant was
 * seeing only "Invalid business mcc (entity.mcc)" with no explanation
 * of what to change it to or why (2026-09-04 finding, confirmed via a
 * side-by-side with Finix's own admin dashboard, which shows this same
 * outcome_message text as the "Underwriter Note").
 *
 * `outcome_message` is used when present (trimmed — Finix's real
 * responses include trailing whitespace/newlines); the humanized
 * `outcome_code` (+ `remediation_details.field_name`, when present) is
 * the fallback for a shape that doesn't include a message.
 *
 * Shared by the MERCHANT.UPDATED webhook handler and the admin "Refresh
 * from Finix" action so there is exactly one place this parsing logic
 * lives — the whole reason a real fix was needed multiple times was
 * multiple independent copies of similar logic drifting apart.
 *
 * Returns null (never a hardcoded fallback string) when there are no
 * parseable outcomes, so callers can decide their own fallback/behavior.
 */
export function parseVerificationOutcomes(verification: unknown): string | null {
  const outcomesRaw = (verification as { outcomes?: unknown })?.outcomes;
  const outcomes: unknown[] = Array.isArray(outcomesRaw) ? outcomesRaw : [];

  const items = outcomes
    .map((o) => {
      const outcome = o as { outcome_code?: unknown; outcome_message?: unknown; remediation_details?: { field_name?: unknown } };

      const message = typeof outcome?.outcome_message === "string" ? outcome.outcome_message.trim().replace(/\s+/g, " ") : null;
      if (message) return message;

      const code = typeof outcome?.outcome_code === "string" ? outcome.outcome_code : null;
      if (!code) return null;
      const readable = code.toLowerCase().replace(/_/g, " ").replace(/^./, (c: string) => c.toUpperCase());
      const fieldName = outcome?.remediation_details?.field_name;
      return typeof fieldName === "string" ? `${readable} (${fieldName})` : readable;
    })
    .filter((s): s is string => !!s);

  if (items.length === 0) return null;
  return items.map((i) => `• ${i}`).join("<br/>");
}

/**
 * Extracts the Finix file `type` a FILE_UPLOAD outcome actually asked
 * for (e.g. "ENHANCED_DUE_DILIGENCE_DOCUMENT"), from the same `outcomes`
 * array `parseVerificationOutcomes` reads. The merchant-facing upload
 * route previously hardcoded every uploaded file's Finix type to the
 * generic "ADDITIONAL_DOCUMENTATION" regardless of what was actually
 * requested (2026-09-04 finding, confirmed against Lighthouse Baptist
 * Church's real Verification, which specifically asked for
 * "ENHANCED_DUE_DILIGENCE_DOCUMENT") — a mismatched type risks Finix's
 * underwriting system not recognizing the upload as satisfying that
 * specific outstanding requirement.
 *
 * Returns the first FILE_UPLOAD outcome's file_type found, or null if
 * there isn't one (no file was actually requested, or the shape didn't
 * include it) — callers should fall back to a safe generic type in that
 * case rather than sending an empty/invalid type to Finix.
 *
 * Only returns a single type: today's upload form has one file slot, so
 * multiple simultaneous FILE_UPLOAD outcomes with different file_types
 * aren't yet distinguishable at submission time — a known limitation,
 * not something this function can resolve on its own.
 */
export function extractRequestedFileType(verification: unknown): string | null {
  const outcomesRaw = (verification as { outcomes?: unknown })?.outcomes;
  const outcomes: unknown[] = Array.isArray(outcomesRaw) ? outcomesRaw : [];

  for (const o of outcomes) {
    const outcome = o as { remediation_details?: { type?: unknown; file_type?: unknown } };
    if (outcome?.remediation_details?.type === "FILE_UPLOAD" && typeof outcome.remediation_details.file_type === "string") {
      return outcome.remediation_details.file_type;
    }
  }
  return null;
}
