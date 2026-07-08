import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runSyncJob } from "@/lib/finix/sync/runSyncJob";

/**
 * Runs merchant + transfers + settlements + disputes sync for one church.
 * Skips fees/payouts/subscriptions (unimplemented stubs).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ churchId: string }> }
) {
  const { churchId } = await params;

  try {
    const church = await prisma.church.findUnique({ where: { id: churchId } });

    if (!church) {
      return NextResponse.json({ error: "Church not found" }, { status: 404 });
    }

    if (!church.finixMerchantId) {
      return NextResponse.json(
        { error: "Church has no finixMerchantId to sync" },
        { status: 400 }
      );
    }

    const results = {
      merchant: await runSyncJob({
        jobType: "merchant",
        finixMerchantId: church.finixMerchantId,
        churchId,
      }),
      transfers: await runSyncJob({
        jobType: "transfers",
        finixMerchantId: church.finixMerchantId,
        churchId,
      }),
      settlements: await runSyncJob({
        jobType: "settlements",
        finixMerchantId: church.finixMerchantId,
        churchId,
      }),
      disputes: await runSyncJob({
        jobType: "disputes",
        finixMerchantId: church.finixMerchantId,
        churchId,
      }),
    };

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error(`Church sync failed for ${churchId}:`, error);
    return NextResponse.json({ error: error?.message ?? "Sync failed" }, { status: 500 });
  }
}
