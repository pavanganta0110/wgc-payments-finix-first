import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { resolveDateRange } from "@/lib/dateRangePresets";
import { buildCsvExport, csvResponse, type CsvColumn } from "@/lib/csvExport";
import type { FinixDispute } from "@prisma/client";

const COLUMNS: CsvColumn<FinixDispute>[] = [
  { header: "ID", value: (d) => d.finixDisputeId },
  { header: "Created", value: (d) => (d.createdAtFinix ? d.createdAtFinix.toISOString() : "") },
  { header: "Payment ID", value: (d) => d.finixTransferId || "" },
  { header: "Reason", value: (d) => d.reason || "" },
  { header: "State", value: (d) => d.state || "UNKNOWN" },
  { header: "Outcome", value: (d) => d.outcome || "" },
  { header: "Evidence Due", value: (d) => (d.evidenceDueAt ? d.evidenceDueAt.toISOString() : "") },
  { header: "Responded", value: (d) => (d.respondedAt ? d.respondedAt.toISOString() : "") },
  { header: "Resolved", value: (d) => (d.resolvedAt ? d.resolvedAt.toISOString() : "") },
  { header: "Amount", value: (d) => formatCents(d.amountCents ?? 0) },
];

export async function GET(req: Request) {
  const session = await getSession();

  if (!session || session.role !== "church_admin" || !session.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const state = searchParams.get("state") || undefined;
  const range = searchParams.get("range") || undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;
  const { from: startDate, to: endDate } = resolveDateRange(range, from, to);
  const dateFilter = startDate ? { gte: startDate, ...(endDate ? { lte: endDate } : {}) } : undefined;

  const disputes = await prisma.finixDispute.findMany({
    where: {
      churchId: session.churchId,
      ...(state ? { state } : {}),
      ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
    },
    orderBy: { createdAtFinix: "desc" },
  });

  const csv = buildCsvExport(disputes, COLUMNS);
  return csvResponse(csv, "disputes.csv");
}
