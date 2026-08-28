import { NextResponse } from "next/server";
import { detectPromoShortfalls } from "@/lib/billing/promoShortfallDetection";
import { alertCronMisconfiguration } from "@/lib/cron/alertCronMisconfiguration";

/** Same CRON_SECRET auth pattern as /api/cron/reconcile-subscriptions.
 * Runs on the 1st of each month (see vercel.json) — checks the calendar
 * month that just completed. Only ever FLAGS orgs for admin review; never
 * charges anything itself (see promoShortfallCharge.ts). */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET is not configured in production");
      alertCronMisconfiguration("promo-shortfall-check");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await detectPromoShortfalls();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Promo shortfall detection cron failed:", err);
    return NextResponse.json({ success: false, error: "Detection failed" }, { status: 500 });
  }
}
