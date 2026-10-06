import { NextResponse } from "next/server";
import { runMerchantLifecycleEmails } from "@/lib/lifecycle/merchantLifecycleEmails";
import { alertCronMisconfiguration } from "@/lib/cron/alertCronMisconfiguration";

/** Same CRON_SECRET auth pattern as every other cron route. Runs daily —
 * each stage only sends to a church actually due for its next nudge (or
 * for TEXTING_ANNOUNCEMENT, only once ever), so a daily cadence is fine
 * even though most days most churches have nothing due. */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET is not configured in production");
      alertCronMisconfiguration("merchant-lifecycle-emails");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runMerchantLifecycleEmails();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Merchant lifecycle emails cron failed:", err);
    return NextResponse.json({ success: false, error: "Run failed" }, { status: 500 });
  }
}
