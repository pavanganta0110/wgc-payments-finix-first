import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface SettlementsListFilters {
  dateFilter?: { gte: Date; lte?: Date };
  status?: string;
  depositStatus?: "linked" | "unlinked";
  reconciliationStatus?: string;
  minGrossCents?: number;
  maxGrossCents?: number;
  traceId?: string;
}

export interface SettlementsListSort {
  key: "createdAtFinix" | "totalAmountCents" | "netAmountCents" | "feeAmountCents" | "disputeAmountCents";
  dir: "asc" | "desc";
}

/**
 * Server-side paginated settlements list. Unlike Disputes/Payments (which
 * pull up to 300 rows and filter/sort in memory), settlements carry their
 * own pre-aggregated counts/totals via recomputeSettlementAggregates, so
 * every filter and sort here runs as a real indexed DB query instead of an
 * in-memory scan — no full-history client load, no N+1 per row.
 */
export async function loadSettlementsList(
  churchId: string,
  filters: SettlementsListFilters,
  sort: SettlementsListSort,
  page: number,
  pageSize: number,
) {
  // Resolved before the main query (not filtered in-memory after paging)
  // so a deposit-status filter doesn't shrink an already-paginated page.
  let linkedSettlementIds: string[] | null = null;
  if (filters.depositStatus) {
    const linked = await prisma.finixFundingTransferAttempt.findMany({
      where: { churchId, finixSettlementId: { not: null } },
      select: { finixSettlementId: true },
      distinct: ["finixSettlementId"],
    });
    linkedSettlementIds = linked.map((d) => d.finixSettlementId!).filter(Boolean);
  }

  const where: Prisma.FinixSettlementWhereInput = {
    churchId,
    ...(filters.dateFilter ? { createdAtFinix: filters.dateFilter } : {}),
    ...(filters.status ? { processorState: filters.status } : {}),
    ...(filters.reconciliationStatus ? { reconciliationStatus: filters.reconciliationStatus } : {}),
    ...(filters.traceId ? { traceId: filters.traceId } : {}),
    ...(filters.minGrossCents != null || filters.maxGrossCents != null
      ? {
          totalAmountCents: {
            ...(filters.minGrossCents != null ? { gte: filters.minGrossCents } : {}),
            ...(filters.maxGrossCents != null ? { lte: filters.maxGrossCents } : {}),
          },
        }
      : {}),
    ...(filters.depositStatus === "linked" ? { finixSettlementId: { in: linkedSettlementIds ?? [] } } : {}),
    ...(filters.depositStatus === "unlinked" ? { finixSettlementId: { notIn: linkedSettlementIds ?? [] } } : {}),
  };

  const [totalCount, settlements] = await Promise.all([
    prisma.finixSettlement.count({ where }),
    prisma.finixSettlement.findMany({
      where,
      orderBy: { [sort.key]: sort.dir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const settlementIds = settlements.map((s) => s.finixSettlementId);
  const deposits = settlementIds.length
    ? await prisma.finixFundingTransferAttempt.findMany({ where: { finixSettlementId: { in: settlementIds } } })
    : [];
  const depositBySettlement = new Map(deposits.map((d) => [d.finixSettlementId, d]));

  const rows = settlements.map((settlement) => ({
    settlement,
    deposit: depositBySettlement.get(settlement.finixSettlementId) ?? null,
  }));

  return { rows, totalCount, page, pageSize };
}

export type SettlementListRow = Awaited<ReturnType<typeof loadSettlementsList>>["rows"][number];
