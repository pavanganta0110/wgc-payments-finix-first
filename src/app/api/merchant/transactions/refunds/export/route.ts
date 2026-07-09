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

  const refunds = await prisma.finixRefundOrReversal.findMany({
    where: {
      churchId: session.churchId,
      ...(state ? { state } : {}),
      ...(dateFilter ? { createdAtFinix: dateFilter } : {}),
    },
    orderBy: { createdAtFinix: "desc" },
  });

  const header = ["ID", "Created", "Original Payment", "State", "Source", "Amount"];
  const lines = [header.join(",")];

  for (const r of refunds) {
    lines.push(
      [
        csvEscape(r.finixReversalId),
        csvEscape(r.createdAtFinix ? r.createdAtFinix.toISOString() : ""),
        csvEscape(r.finixOriginalTransferId || ""),
        csvEscape(r.state || "UNKNOWN"),
        csvEscape(r.source === "wgc_giving_page" ? "WGC Giving Page" : "Finix Dashboard"),
        csvEscape(formatCents(r.amountCents ?? 0)),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="refunds.csv"`,
    },
  });
}
