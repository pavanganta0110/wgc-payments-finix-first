/**
 * WGC-facing settlement status, computed on read from processorState (the
 * raw, never-overwritten value from the processor). Unlike disputes, a
 * settlement's own lifecycle is already fully described by the processor's
 * state field — there's no WGC-side sub-status to derive from timestamps,
 * so this is a normalization/mapping layer rather than a real derivation.
 * Any processor state we haven't seen before falls through to UNKNOWN
 * rather than being silently mislabeled as something it isn't.
 */
export type SettlementDisplayStatus =
  | "ACCRUING"
  | "PENDING"
  | "PROCESSING"
  | "READY"
  | "FUNDED"
  | "SETTLED"
  | "PAID"
  | "FAILED"
  | "CANCELED"
  | "UNKNOWN";

const KNOWN_STATES = new Set<SettlementDisplayStatus>([
  "ACCRUING",
  "PENDING",
  "PROCESSING",
  "READY",
  "FUNDED",
  "SETTLED",
  "PAID",
  "FAILED",
  "CANCELED",
]);

export interface SettlementStatusInput {
  processorState: string | null;
}

export function resolveSettlementDisplayStatus(settlement: SettlementStatusInput): SettlementDisplayStatus {
  const processorState = (settlement.processorState || "").toUpperCase();
  if (KNOWN_STATES.has(processorState as SettlementDisplayStatus)) {
    return processorState as SettlementDisplayStatus;
  }
  return "UNKNOWN";
}

export const SETTLEMENT_DISPLAY_STATUS_LABELS: Record<SettlementDisplayStatus, string> = {
  ACCRUING: "Accruing",
  PENDING: "Pending",
  PROCESSING: "Processing",
  READY: "Ready",
  FUNDED: "Funded",
  SETTLED: "Settled",
  PAID: "Paid",
  FAILED: "Failed",
  CANCELED: "Canceled",
  UNKNOWN: "Unknown",
};
