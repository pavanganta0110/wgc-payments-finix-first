import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMerchantSession } from "@/lib/auth/requireMerchantSession";
import { requirePermission } from "@/lib/auth/permissions";
import { isAuthError, ForbiddenError } from "@/lib/auth/errors";
import { formatCents } from "@/lib/format";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Merchant-facing receipt for one WGC billing charge, as a printable page
 * (browser Print → Save as PDF). The organization always comes from the
 * session, never the request, so one merchant can never open another's receipt.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  let auth;
  try {
    auth = await requireMerchantSession(true); // billing must stay reachable while restricted, same as the Subscription page
  } catch (err) {
    if (isAuthError(err)) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  try {
    requirePermission(auth, "canViewBillingHistory");
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }

  const { chargeId } = await params;
  const charge = await prisma.billingCharge.findFirst({ where: { id: chargeId, organizationId: auth.churchId } });
  if (!charge) return NextResponse.json({ error: "Receipt not found." }, { status: 404 });
  if (charge.status !== "SUCCEEDED") {
    return NextResponse.json({ error: "A receipt is only available for successful payments." }, { status: 404 });
  }

  const [church, billingAccount] = await Promise.all([
    prisma.church.findUnique({ where: { id: auth.churchId }, select: { name: true } }),
    prisma.wgcBillingAccount.findUnique({ where: { organizationId: auth.churchId }, select: { maskedBillingDetails: true } }),
  ]);

  const paidAt = (charge.succeededAt ?? charge.attemptedAt).toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "long", day: "numeric" });
  const orgName = esc(church?.name ?? "Your organization");
  const rows: [string, string][] = [
    ["Receipt number", esc(charge.id)],
    ["Date paid", esc(paidAt)],
    ["Description", esc(titleCase(charge.chargeType))],
    ...(charge.billingPeriod ? ([["Billing period", esc(charge.billingPeriod)]] as [string, string][]) : []),
    ["Billing method", esc(billingAccount?.maskedBillingDetails || "On file")],
  ];

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt – WGC Payments</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0;background:#f8fafc}
  .page{max-width:640px;margin:32px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:40px}
  h1{font-size:22px;margin:0 0 4px} .muted{color:#64748b;font-size:14px}
  table{width:100%;border-collapse:collapse;margin:28px 0} td{padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
  td:first-child{color:#64748b} td:last-child{text-align:right;font-weight:600}
  .total td{border-bottom:0;font-size:18px;color:#0f172a} .total td:first-child{color:#0f172a;font-weight:700}
  .thanks{margin-top:24px;font-size:14px;line-height:1.6}
  button{margin-top:24px;padding:10px 18px;border:0;border-radius:10px;background:#0f172a;color:#fff;font-weight:600;cursor:pointer}
  @media print{body{background:#fff}.page{border:0;margin:0}button{display:none}}
</style></head><body><div class="page">
  <h1>WGC Payments</h1>
  <div class="muted">Payment receipt · Billed to ${orgName}</div>
  <table>
    ${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}
    <tr class="total"><td>Amount paid</td><td>${esc(formatCents(charge.amountCents))}</td></tr>
  </table>
  <p class="thanks">Thank you for being a part of WGC Payments. We're grateful to serve ${orgName} and the work you do in your community.</p>
  <p class="muted">Questions? Contact support@wgcpayments.com.</p>
  <button onclick="window.print()">Print or save as PDF</button>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
