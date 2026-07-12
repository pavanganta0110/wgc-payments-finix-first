export const DEFAULT_THANK_YOU_MESSAGE = "Thank you for your generosity this year — your support makes a real difference.";

export const STATEMENT_DISCLAIMER =
  "This statement summarizes donations recorded by the organization during the selected year. It is provided for record-keeping purposes only and does not constitute tax advice. Donors should consult a qualified tax professional regarding their individual circumstances.";

type StatementSettingsSource = {
  statementThankYouMessage?: string | null;
  statementDisclaimer?: string | null;
  statementShowTaxId?: boolean | null;
  statementShowDonorCoveredFees?: boolean | null;
  taxId?: string | null;
} | null;

/** Merges an organization's Annual Statement Settings over the built-in defaults — the same fallback rule used at generation time (custom text if set, else the default) and at send time (subject template tokens). */
export function resolveStatementPdfSettings(church: StatementSettingsSource) {
  return {
    thankYouMessage: church?.statementThankYouMessage || DEFAULT_THANK_YOU_MESSAGE,
    disclaimer: church?.statementDisclaimer || STATEMENT_DISCLAIMER,
    organizationTaxId: church?.statementShowTaxId ? church.taxId ?? null : null,
    showDonorCoveredFees: church?.statementShowDonorCoveredFees ?? false,
  };
}
