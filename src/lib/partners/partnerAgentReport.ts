import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ATTRIBUTED_WHERE, JOINS, METHOD_SQL, SUCCESSFUL_CHARGE_WHERE, inRange, type MethodKey } from "@/lib/admin/platformMetrics";
import { buildCsvExport, type CsvColumn } from "@/lib/csvExport";

/**
 * What a partner needs to pay its agents: for each organization, who referred it, when it was
 * boarded, and what it processed in a window. Volumes follow the admin dashboard's rules
 * (successful Finix charges, split by card and ACH); refunds are succeeded Finix refunds and
 * returns are ACH bank returns. "WGC fee charged" is WGC's own record of the fee on each payment.
 * It deliberately has no Finix cost or residual: those exist only as platform-wide monthly
 * statements, so any per-agent figure would be an estimate.
 *
 * `partnerId` must come from the signed-in partner session, never from a request.
 * Window is [from, to).
 */

export interface AgentReportRow {
  agentId: string | null;
  agentName: string;
  agentEmail: string;
  churchId: string;
  organization: string;
  reference: string;
  status: string;
  /** ISO date the organization was boarded (approved), or its creation date when no approval is recorded. */
  boardedAt: string;
  boardedInWindow: boolean;
  cardCents: number;
  cardCount: number;
  achCents: number;
  achCount: number;
  otherCents: number;
  otherCount: number;
  refundsCents: number;
  refundsCount: number;
  achReturnsCents: number;
  achReturnsCount: number;
  wgcFeeChargedCents: number;
}

export const UNASSIGNED_AGENT = "(No agent)";

const num = (v: bigint | number | null | undefined) => Number(v ?? 0);

export async function loadPartnerAgentReport(partnerId: string, from: Date, to: Date): Promise<AgentReportRow[]> {
  const churches = await prisma.church.findMany({
    where: { partnerId },
    select: {
      id: true,
      name: true,
      partnerReference: true,
      status: true,
      createdAt: true,
      partnerAgent: { select: { id: true, name: true, email: true } },
    },
    orderBy: { name: "asc" },
  });
  if (churches.length === 0) return [];
  const ids = churches.map((c) => c.id);
  const inIds = Prisma.join(ids);
  const created = Prisma.sql`ft."createdAtFinix"`;

  const [methodRows, charged, refunds, returns, approvals] = await Promise.all([
    prisma.$queryRaw<{ church_id: string; method: MethodKey; amount: bigint | null; count: bigint }[]>(Prisma.sql`
      SELECT ft."churchId" AS church_id, ${METHOD_SQL} AS method, SUM(ft."amountCents") AS amount, COUNT(*) AS count
      FROM "FinixTransfer" ft
      ${JOINS}
      WHERE ${SUCCESSFUL_CHARGE_WHERE} AND ${ATTRIBUTED_WHERE} AND ft."churchId" IN (${inIds}) AND ${inRange(created, from, to)}
      GROUP BY 1, 2`),
    prisma.$queryRaw<{ church_id: string; charged: number | null }[]>(Prisma.sql`
      SELECT p."churchId" AS church_id,
             SUM(ROUND(COALESCE(p."donationAmountCents", 0)::numeric * COALESCE(p."percentageBps", 0) / 10000) + COALESCE(p."fixedFeeCents", 0))::float8 AS charged
      FROM "Payment" p
      WHERE p."status" = 'SUCCEEDED' AND p."churchId" IN (${inIds}) AND p."createdAt" >= ${from} AND p."createdAt" < ${to}
      GROUP BY p."churchId"`),
    prisma.finixRefundOrReversal.groupBy({
      by: ["churchId"],
      where: { churchId: { in: ids }, state: { equals: "SUCCEEDED", mode: "insensitive" }, createdAtFinix: { gte: from, lt: to } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.bankReturn.groupBy({
      by: ["churchId"],
      where: { churchId: { in: ids }, createdAtFinix: { gte: from, lt: to } },
      _sum: { amountCents: true },
      _count: { _all: true },
    }),
    prisma.partnerBillableApproval.findMany({ where: { partnerId }, select: { churchId: true, approvedAt: true } }),
  ]);

  const method = new Map<string, Partial<Record<MethodKey, { amount: number; count: number }>>>();
  for (const r of methodRows) {
    const entry = method.get(r.church_id) ?? {};
    entry[r.method] = { amount: num(r.amount), count: num(r.count) };
    method.set(r.church_id, entry);
  }
  const chargedBy = new Map(charged.map((r) => [r.church_id, Math.round(r.charged ?? 0)]));
  const refundBy = new Map(refunds.map((r) => [r.churchId, r]));
  const returnBy = new Map(returns.map((r) => [r.churchId, r]));
  const approvedBy = new Map(approvals.map((a) => [a.churchId, a.approvedAt]));

  return churches.map((c) => {
    const m = method.get(c.id) ?? {};
    const boarded = approvedBy.get(c.id) ?? c.createdAt;
    const refund = refundBy.get(c.id);
    const ret = returnBy.get(c.id);
    return {
      agentId: c.partnerAgent?.id ?? null,
      agentName: c.partnerAgent?.name ?? UNASSIGNED_AGENT,
      agentEmail: c.partnerAgent?.email ?? "",
      churchId: c.id,
      organization: c.name,
      reference: c.partnerReference ?? "",
      status: c.status === "ACTIVE" ? "Active" : "Terminated",
      boardedAt: boarded.toISOString().slice(0, 10),
      boardedInWindow: boarded >= from && boarded < to,
      cardCents: m.CARD?.amount ?? 0,
      cardCount: m.CARD?.count ?? 0,
      achCents: m.ACH?.amount ?? 0,
      achCount: m.ACH?.count ?? 0,
      otherCents: m.OTHER?.amount ?? 0,
      otherCount: m.OTHER?.count ?? 0,
      refundsCents: refund?._sum.amountCents ?? 0,
      refundsCount: refund?._count._all ?? 0,
      achReturnsCents: ret?._sum.amountCents ?? 0,
      achReturnsCount: ret?._count._all ?? 0,
      wgcFeeChargedCents: chargedBy.get(c.id) ?? 0,
    };
  });
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export interface AgentSummaryRow {
  agentName: string;
  agentEmail: string;
  organizationsTotal: number;
  organizationsActive: number;
  boardedInWindow: number;
  cardCents: number;
  cardCount: number;
  achCents: number;
  achCount: number;
  otherCents: number;
  refundsCents: number;
  achReturnsCents: number;
  wgcFeeChargedCents: number;
}

/** One row per agent (and one for organizations with no agent), sorted by name with "no agent" last. */
export function summarizeByAgent(rows: AgentReportRow[]): AgentSummaryRow[] {
  const byKey = new Map<string, AgentSummaryRow>();
  for (const r of rows) {
    const key = r.agentId ?? "";
    const s =
      byKey.get(key) ??
      { agentName: r.agentName, agentEmail: r.agentEmail, organizationsTotal: 0, organizationsActive: 0, boardedInWindow: 0, cardCents: 0, cardCount: 0, achCents: 0, achCount: 0, otherCents: 0, refundsCents: 0, achReturnsCents: 0, wgcFeeChargedCents: 0 };
    s.organizationsTotal += 1;
    if (r.status === "Active") s.organizationsActive += 1;
    if (r.boardedInWindow) s.boardedInWindow += 1;
    s.cardCents += r.cardCents;
    s.cardCount += r.cardCount;
    s.achCents += r.achCents;
    s.achCount += r.achCount;
    s.otherCents += r.otherCents;
    s.refundsCents += r.refundsCents;
    s.achReturnsCents += r.achReturnsCents;
    s.wgcFeeChargedCents += r.wgcFeeChargedCents;
    byKey.set(key, s);
  }
  return [...byKey.entries()]
    .sort(([ka, a], [kb, b]) => (ka === "" ? 1 : 0) - (kb === "" ? 1 : 0) || a.agentName.localeCompare(b.agentName))
    .map(([, s]) => s);
}

export function agentSummaryCsv(rows: AgentSummaryRow[]): string {
  const cols: CsvColumn<AgentSummaryRow>[] = [
    { header: "Agent", value: (r) => r.agentName },
    { header: "Agent email", value: (r) => r.agentEmail },
    { header: "Organizations (total)", value: (r) => String(r.organizationsTotal) },
    { header: "Organizations active", value: (r) => String(r.organizationsActive) },
    { header: "Boarded in period", value: (r) => String(r.boardedInWindow) },
    { header: "Card volume (USD)", value: (r) => dollars(r.cardCents) },
    { header: "Card payments", value: (r) => String(r.cardCount) },
    { header: "ACH volume (USD)", value: (r) => dollars(r.achCents) },
    { header: "ACH payments", value: (r) => String(r.achCount) },
    { header: "Other volume (USD)", value: (r) => dollars(r.otherCents) },
    { header: "Total volume (USD)", value: (r) => dollars(r.cardCents + r.achCents + r.otherCents) },
    { header: "Refunds (USD)", value: (r) => dollars(r.refundsCents) },
    { header: "ACH returns (USD)", value: (r) => dollars(r.achReturnsCents) },
    { header: "Net volume (USD)", value: (r) => dollars(r.cardCents + r.achCents + r.otherCents - r.refundsCents - r.achReturnsCents) },
    { header: "WGC fee charged (USD)", value: (r) => dollars(r.wgcFeeChargedCents) },
  ];
  return buildCsvExport(rows, cols);
}

export function organizationDetailCsv(rows: AgentReportRow[]): string {
  const sorted = [...rows].sort((a, b) => (a.agentId ? 0 : 1) - (b.agentId ? 0 : 1) || a.agentName.localeCompare(b.agentName) || a.organization.localeCompare(b.organization));
  const cols: CsvColumn<AgentReportRow>[] = [
    { header: "Agent", value: (r) => r.agentName },
    { header: "Agent email", value: (r) => r.agentEmail },
    { header: "Organization", value: (r) => r.organization },
    { header: "Your reference", value: (r) => r.reference },
    { header: "Status", value: (r) => r.status },
    { header: "Boarded", value: (r) => r.boardedAt },
    { header: "Boarded in period", value: (r) => (r.boardedInWindow ? "Yes" : "No") },
    { header: "Card volume (USD)", value: (r) => dollars(r.cardCents) },
    { header: "Card payments", value: (r) => String(r.cardCount) },
    { header: "ACH volume (USD)", value: (r) => dollars(r.achCents) },
    { header: "ACH payments", value: (r) => String(r.achCount) },
    { header: "Other volume (USD)", value: (r) => dollars(r.otherCents) },
    { header: "Total volume (USD)", value: (r) => dollars(r.cardCents + r.achCents + r.otherCents) },
    { header: "Refunds (USD)", value: (r) => dollars(r.refundsCents) },
    { header: "Refund count", value: (r) => String(r.refundsCount) },
    { header: "ACH returns (USD)", value: (r) => dollars(r.achReturnsCents) },
    { header: "ACH return count", value: (r) => String(r.achReturnsCount) },
    { header: "Net volume (USD)", value: (r) => dollars(r.cardCents + r.achCents + r.otherCents - r.refundsCents - r.achReturnsCents) },
    { header: "WGC fee charged (USD)", value: (r) => dollars(r.wgcFeeChargedCents) },
  ];
  return buildCsvExport(sorted, cols);
}
