import { NextResponse } from "next/server";
import { reconcileStaleInvoicePaymentAttempts } from "@/lib/reconciliation/invoicePaymentReconciliationSweep";
import { alertCronMisconfiguration } from "@/lib/cron/alertCronMisconfiguration";

/**
 * Stage 2 Task 8 — scheduled orchestration of Stage 1's InvoicePayment
 * recovery primitives (see
 * src/lib/reconciliation/invoicePaymentReconciliationSweep.ts). Same
 * CRON_SECRET auth pattern as every other /api/cron/* route.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET is not configured in production");
      alertCronMisconfiguration("reconcile-invoice-payments");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileStaleInvoicePaymentAttempts();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Invoice payment reconciliation cron failed:", err);
    return NextResponse.json({ success: false, error: "Reconciliation failed" }, { status: 500 });
  }
}
