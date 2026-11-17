import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { csvResponse } from "@/lib/csvExport";
import { isAuthError } from "@/lib/auth/errors";
import { requirePartnerSession } from "@/lib/partners/partnerSession";
import { agentSummaryCsv, loadPartnerAgentReport, organizationDetailCsv, summarizeByAgent } from "@/lib/partners/partnerAgentReport";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

const startOfDay = (value: string | null): Date | null => {
  if (!value || !DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * CSV downloads for the signed-in partner (any role, including reports-only; a WGC admin's
 * read-only view can read too). `type=agents` is one row per agent, `type=organizations` is one
 * row per organization. `from` and `to` are days, both included. The partner comes from the
 * session; nothing in the request can point it at another partner.
 */
export async function GET(req: Request) {
  try {
    const session = await requirePartnerSession();
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type");
    if (type !== "agents" && type !== "organizations") return NextResponse.json({ error: "type must be agents or organizations." }, { status: 400 });

    const from = startOfDay(searchParams.get("from"));
    const lastDay = startOfDay(searchParams.get("to"));
    if (!from || !lastDay) return NextResponse.json({ error: "Dates must look like 2026-10-31." }, { status: 400 });
    if (from.getTime() > lastDay.getTime()) return NextResponse.json({ error: "The start date must not be after the end date." }, { status: 400 });
    if ((lastDay.getTime() - from.getTime()) / DAY_MS > MAX_DAYS) return NextResponse.json({ error: `Pick a range of ${MAX_DAYS} days or fewer.` }, { status: 400 });

    const rows = await loadPartnerAgentReport(session.partnerId, from, new Date(lastDay.getTime() + DAY_MS));
    const csv = type === "agents" ? agentSummaryCsv(summarizeByAgent(rows)) : organizationDetailCsv(rows);
    const filename = `${type === "agents" ? "agent-summary" : "organization-detail"}_${searchParams.get("from")}_to_${searchParams.get("to")}.csv`;
    if (!session.readOnly) await createAuditLog({ action: "PARTNER_REPORT_DOWNLOADED", actorEmail: session.email, metadata: { partnerId: session.partnerId, type, from: searchParams.get("from"), to: searchParams.get("to") } });
    return csvResponse(csv, filename);
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
