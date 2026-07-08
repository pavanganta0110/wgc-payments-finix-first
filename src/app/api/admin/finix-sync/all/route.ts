import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runSyncJob } from "@/lib/finix/sync/runSyncJob";

/**
 * Syncs merchant + transfers + settlements + disputes for every church with
 * a finixMerchantId. Intended for a nightly cron trigger or manual admin
 * "sync everything" button. Runs sequentially to avoid hammering Finix.
 */
export async function POST() {
  const churches = await prisma.church.findMany({
    where: { finixMerchantId: { not: null } },
  });

  const summary: { churchId: string; status: "ok" | "error"; error?: string }[] = [];

  for (const church of churches) {
    if (!church.finixMerchantId) continue;

    try {
      await runSyncJob({
        jobType: "merchant",
        finixMerchantId: church.finixMerchantId,
        churchId: church.id,
      });
      await runSyncJob({
        jobType: "transfers",
        finixMerchantId: church.finixMerchantId,
        churchId: church.id,
      });
      await runSyncJob({
        jobType: "settlements",
        finixMerchantId: church.finixMerchantId,
        churchId: church.id,
      });
      await runSyncJob({
        jobType: "disputes",
        finixMerchantId: church.finixMerchantId,
        churchId: church.id,
      });
      summary.push({ churchId: church.id, status: "ok" });
    } catch (error: any) {
      console.error(`Full sync failed for church ${church.id}:`, error);
      summary.push({ churchId: church.id, status: "error", error: error?.message });
    }
  }

  return NextResponse.json({ success: true, churchesProcessed: churches.length, summary });
}
