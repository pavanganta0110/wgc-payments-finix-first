import { NextResponse } from "next/server";
import { reconcileStaleTransfers, reconcileStalePaymentAttempts } from "@/lib/reconciliation/paymentReconciliationSweep";
import { alertCronMisconfiguration } from "@/lib/cron/alertCronMisconfiguration";

/**
 * Stage 2 Task 8 — scheduled orchestration of Stage 1's Payment recovery
 * primitives (see src/lib/reconciliation/paymentReconciliationSweep.ts for
 * the full design/safety rationale). Same CRON_SECRET auth pattern as
 * every other /api/cron/* route.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET is not configured in production");
      alertCronMisconfiguration("reconcile-payments");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [staleTransfers, stalePaymentAttempts] = await Promise.all([
      reconcileStaleTransfers(),
      reconcileStalePaymentAttempts(),
    ]);
    return NextResponse.json({ success: true, staleTransfers, stalePaymentAttempts });
  } catch (err) {
    console.error("Payment reconciliation cron failed:", err);
    return NextResponse.json({ success: false, error: "Reconciliation failed" }, { status: 500 });
  }
}
