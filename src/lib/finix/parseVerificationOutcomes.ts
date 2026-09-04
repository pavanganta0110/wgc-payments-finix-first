/**
 * Parses a Finix Verification resource's `outcomes` array into a
 * human-readable, "<br/>"-joined requested-items string, matching the
 * shape documented at docs.finix.com/guides/platform-payments/
 * onboarding-sellers/seller-onboarding-update-requests. Each outcome's
 * `outcome_code` (e.g. "BANK_STATEMENT_ONE_MONTH_REQUESTED") becomes a
 * readable line; `remediation_details.field_name`, when present, is
 * appended so a field-correction request names the actual field.
 *
 * Shared by the MERCHANT.UPDATED webhook handler and the admin "Refresh
 * from Finix" action so there is exactly one place this parsing logic
 * lives — the whole reason today's fix was needed three separate times
 * was three independent copies of similar logic drifting apart.
 *
 * Returns null (never a hardcoded fallback string) when there are no
 * parseable outcomes, so callers can decide their own fallback/behavior.
 */
export function parseVerificationOutcomes(verification: unknown): string | null {
  const outcomesRaw = (verification as { outcomes?: unknown })?.outcomes;
  const outcomes: unknown[] = Array.isArray(outcomesRaw) ? outcomesRaw : [];

  const items = outcomes
    .map((o) => {
      const outcome = o as { outcome_code?: unknown; remediation_details?: { field_name?: unknown } };
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
