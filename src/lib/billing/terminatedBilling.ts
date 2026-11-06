import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { logBillingAuditEvent } from "@/lib/billing/billingAudit";

/**
 * A terminated organization must stop being billed. Finix tracks the organization's payment
 * processing separately from WGC's own subscriptions (the platform subscription and the text
 * add-on), which charge the organization's saved payment method on WGC's billing merchant, so
 * terminating the merchant does not stop them: they run until somebody cancels them.
 *
 * Idempotent and safe to call repeatedly (a redelivered webhook, the admin "Resync from Finix"
 * action). It never throws: a termination must be recorded even if Finix cannot be reached, and
 * the outcome is returned so the caller can tell WGC admin what still needs doing.
 */

export type StopBillingOutcome = "canceled" | "already_canceled" | "none" | "failed";

export interface StopBillingResult {
  wgcSubscription: StopBillingOutcome;
  smsAddon: StopBillingOutcome;
}

const ACTOR = { actorEmail: "system", actorRole: "system" } as const;
const REASON = "ORGANIZATION_TERMINATED";

async function cancelRow(params: {
  organizationId: string;
  entityType: "WgcSubscription" | "SmsAddonSubscription";
  row: { id: string; status: string; finixSubscriptionId: string | null } | null;
  markCanceled: (id: string, at: Date) => Promise<unknown>;
}): Promise<StopBillingOutcome> {
  const { organizationId, entityType, row } = params;
  if (!row) return "none";
  if (row.status === "CANCELED") return "already_canceled";
  if (!row.finixSubscriptionId) return "none"; // never created at Finix: nothing can charge

  try {
    await finixClient.cancelSubscription(row.finixSubscriptionId);
    const canceledAt = new Date();
    await params.markCanceled(row.id, canceledAt);
    await logBillingAuditEvent({
      organizationId,
      ...ACTOR,
      action: "subscription.canceled_on_termination",
      entityType,
      entityId: row.id,
      previousValue: { status: row.status },
      newValue: { status: "CANCELED", canceledAt },
      internalReason: REASON,
    });
    return "canceled";
  } catch (err) {
    await logBillingAuditEvent({
      organizationId,
      ...ACTOR,
      action: "subscription.cancel_on_termination_failed",
      entityType,
      entityId: row.id,
      internalReason: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    return "failed";
  }
}

export async function stopBillingForTerminatedOrganization(organizationId: string): Promise<StopBillingResult> {
  let wgcSubscription: StopBillingOutcome = "failed";
  let smsAddon: StopBillingOutcome = "failed";

  try {
    const sub = await prisma.wgcSubscription.findUnique({
      where: { organizationId },
      select: { id: true, status: true, finixSubscriptionId: true },
    });
    wgcSubscription = await cancelRow({
      organizationId,
      entityType: "WgcSubscription",
      row: sub,
      markCanceled: (id, at) =>
        prisma.wgcSubscription.update({
          where: { id },
          data: { status: "CANCELED", canceledAt: at, cancelRequestedAt: at, cancellationReason: REASON },
        }),
    });
  } catch {
    wgcSubscription = "failed";
  }

  try {
    const addon = await prisma.smsAddonSubscription.findUnique({
      where: { organizationId },
      select: { id: true, status: true, finixSubscriptionId: true },
    });
    smsAddon = await cancelRow({
      organizationId,
      entityType: "SmsAddonSubscription",
      row: addon,
      markCanceled: (id, at) => prisma.smsAddonSubscription.update({ where: { id }, data: { status: "CANCELED", canceledAt: at } }),
    });
  } catch {
    smsAddon = "failed";
  }

  return { wgcSubscription, smsAddon };
}

/** What WGC admin is told about billing when an organization is terminated. */
export function describeStopBilling(result: StopBillingResult): string {
  const parts: string[] = [];
  if (result.wgcSubscription === "canceled") parts.push("The organization's WGC subscription was canceled.");
  if (result.smsAddon === "canceled") parts.push("Its text-messaging add-on was canceled.");
  if (result.wgcSubscription === "failed" || result.smsAddon === "failed") {
    parts.push("WGC could not cancel its billing subscription with Finix. Cancel it manually so the organization is not charged again.");
  }
  return parts.join(" ");
}

/** Ids of terminated organizations, for the billing review jobs to skip. */
export async function getTerminatedOrganizationIds(): Promise<string[]> {
  const rows = await prisma.church.findMany({ where: { status: "TERMINATED" }, select: { id: true } });
  return rows.map((r) => r.id);
}
