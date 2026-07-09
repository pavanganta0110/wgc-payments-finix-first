import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import { resolveDateRange } from "@/lib/dateRangePresets";

function csvEscape(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

  const settlements = await prisma.finixSettlement.findMany({
    where: {
      churchId: session.churchId,
      ...(state ? { state } : {}),
      ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
    },
    orderBy: { createdAtFinix: "desc" },
  });

  const header = ["ID", "Created", "State", "Total", "Net", "Fees", "Refunds", "Disputes", "Settled"];
  const lines = [header.join(",")];

  for (const s of settlements) {
    lines.push(
      [
        csvEscape(s.finixSettlementId),
        csvEscape(s.createdAtFinix ? s.createdAtFinix.toISOString() : ""),
        csvEscape(s.state || "UNKNOWN"),
        csvEscape(formatCents(s.totalAmountCents ?? 0)),
        csvEscape(formatCents(s.netAmountCents ?? 0)),
        csvEscape(formatCents(s.feeAmountCents ?? 0)),
        csvEscape(formatCents(s.refundAmountCents ?? 0)),
        csvEscape(formatCents(s.disputeAmountCents ?? 0)),
        csvEscape(s.settledAt ? s.settledAt.toISOString() : ""),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="settlements.csv"`,
    },
  });
}
