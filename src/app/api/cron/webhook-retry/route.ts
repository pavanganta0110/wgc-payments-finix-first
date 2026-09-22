import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { attemptWebhookDelivery } from "@/lib/webhooks/deliverWebhook";
import { alertCronMisconfiguration } from "@/lib/cron/alertCronMisconfiguration";

/**
 * Runs every 15 minutes (see vercel.json) — retries any webhook delivery
 * whose nextRetryAt has passed. The immediate first attempt happens inline
 * from emitEvent(); this cron is purely the backstop for deliveries that
 * failed and are waiting on backoff, or for a delivery whose inline
 * attempt never got the chance to run (e.g. the process was recycled).
 * Same CRON_SECRET bearer-auth pattern as every other cron in this app.
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (process.env.NODE_ENV === "production") {
    if (!process.env.CRON_SECRET) {
      console.error("CRON_SECRET is not configured in production");
      alertCronMisconfiguration("webhook-retry");
      return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
    }
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const due = await prisma.webhookDelivery.findMany({
    where: { status: "FAILED", nextRetryAt: { lte: new Date() } },
    select: { id: true },
    take: 200,
  });

  let succeeded = 0;
  let stillFailing = 0;
  for (const row of due) {
    const before = await prisma.webhookDelivery.findUnique({ where: { id: row.id }, select: { status: true } });
    await attemptWebhookDelivery(row.id);
    const after = await prisma.webhookDelivery.findUnique({ where: { id: row.id }, select: { status: true } });
    if (before?.status !== "SUCCEEDED" && after?.status === "SUCCEEDED") succeeded++;
    else if (after?.status !== "SUCCEEDED") stillFailing++;
  }

  return NextResponse.json({ success: true, attempted: due.length, succeeded, stillFailing });
}
