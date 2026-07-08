import { prisma } from "@/lib/prisma";
import { syncMerchant } from "@/lib/finix/sync/syncMerchant";
import { syncTransfers } from "@/lib/finix/sync/syncTransfers";
import { syncSettlements } from "@/lib/finix/sync/syncSettlements";
import { syncDisputes } from "@/lib/finix/sync/syncDisputes";

export type SyncJobType = "merchant" | "transfers" | "settlements" | "disputes";

/**
 * Runs one sync job for one merchant, tracked in FinixSyncJob. Only wires up
 * the sync functions that are actually implemented today (merchant,
 * transfers, settlements, disputes) — fees/payouts/subscriptions are stubs
 * and will throw if requested until their Finix API shape is confirmed.
 */
export async function runSyncJob(params: {
  jobType: SyncJobType;
  finixMerchantId: string;
  churchId?: string;
}) {
  const job = await prisma.finixSyncJob.create({
    data: {
      jobType: params.jobType,
      finixMerchantId: params.finixMerchantId,
      churchId: params.churchId ?? null,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  try {
    let result: { processed: number; created: number; updated: number } = {
      processed: 0,
      created: 0,
      updated: 0,
    };

    switch (params.jobType) {
      case "merchant":
        await syncMerchant(params.finixMerchantId, params.churchId);
        result = { processed: 1, created: 0, updated: 1 };
        break;
      case "transfers":
        result = await syncTransfers(params.finixMerchantId, params.churchId);
        break;
      case "settlements":
        result = await syncSettlements(params.finixMerchantId, params.churchId);
        break;
      case "disputes":
        result = await syncDisputes(params.finixMerchantId, params.churchId);
        break;
    }

    await prisma.finixSyncJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        recordsProcessed: result.processed,
        recordsCreated: result.created,
        recordsUpdated: result.updated,
      },
    });

    return result;
  } catch (error: any) {
    await prisma.finixSyncJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        failedAt: new Date(),
        errorMessage: error?.message ?? "Unknown sync error",
      },
    });
    throw error;
  }
}
