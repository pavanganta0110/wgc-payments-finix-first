import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import { reconcileComplianceFormsForChurch, SYNC_TYPES } from "@/lib/finix/sync/complianceForms";

vi.mock("@/lib/finix/client", () => {
  return {
    finixClient: {
      listComplianceFormsForMerchant: vi.fn(),
    },
  };
});

describe("Dashboard Compliance Performance Sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupChurch = async (suffix: string) => {
    const churchId = `perf-church-${suffix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const merchantId = `mid-perf-${suffix}`;
    const slug = `perf-slug-${suffix}-${Date.now()}`;

    // Ensure clean state
    await prisma.synchronizationState.deleteMany({ where: { churchId } });
    await prisma.complianceForm.deleteMany({ where: { churchId } });
    await prisma.church.deleteMany({ where: { id: churchId } });

    await prisma.church.create({
      data: {
        id: churchId,
        name: `Performance Test Church ${suffix}`,
        slug,
        primaryContactEmail: "test@wgc.org",
        status: "ACTIVE",
        finixMerchantId: merchantId,
      },
    });

    return { churchId, merchantId };
  };

  const cleanupChurch = async (churchId: string) => {
    await prisma.synchronizationState.deleteMany({ where: { churchId } });
    await prisma.complianceForm.deleteMany({ where: { churchId } });
    await prisma.church.deleteMany({ where: { id: churchId } });
  };

  it("test 1: empty Finix response stores successful sync state and does not run on second request", async () => {
    const { churchId } = await setupChurch("t1");
    try {
      vi.mocked(finixClient.listComplianceFormsForMerchant).mockResolvedValueOnce({
        _embedded: { compliance_forms: [] },
      });

      // 1st call
      await reconcileComplianceFormsForChurch(churchId);

      expect(finixClient.listComplianceFormsForMerchant).toHaveBeenCalledTimes(1);

      // Verify sync state is written
      const state = await prisma.synchronizationState.findUnique({
        where: { churchId_syncType: { churchId, syncType: SYNC_TYPES.FINIX_COMPLIANCE_FORMS } },
      });
      expect(state).not.toBeNull();
      expect(state?.lastSuccessfulAt).not.toBeNull();
      expect(state?.resultCount).toBe(0);
      expect(state?.lastErrorAt).toBeNull();

      // 2nd call (should be throttled, not invoking Finix again)
      await reconcileComplianceFormsForChurch(churchId);
      expect(finixClient.listComplianceFormsForMerchant).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupChurch(churchId);
    }
  });

  it("test 2: non-empty Finix response upserts forms and records sync state", async () => {
    const { churchId } = await setupChurch("t2");
    try {
      vi.mocked(finixClient.listComplianceFormsForMerchant).mockResolvedValueOnce({
        _embedded: {
          compliance_forms: [
            {
              id: `cf_mock_${churchId}`,
              type: "PCI_SAQ_A",
              state: "complete",
              due_at: null,
              valid_from: null,
              valid_until: null,
              created_at: "2025-07-07T18:05:01Z",
              updated_at: "2025-07-07T18:05:01Z",
            },
          ],
        },
      });

      await reconcileComplianceFormsForChurch(churchId);

      expect(finixClient.listComplianceFormsForMerchant).toHaveBeenCalledTimes(1);

      // Verify compliance form was saved
      const forms = await prisma.complianceForm.findMany({ where: { churchId } });
      expect(forms.length).toBe(1);
      expect(forms[0].finixComplianceFormId).toBe(`cf_mock_${churchId}`);

      // Verify sync state
      const state = await prisma.synchronizationState.findUnique({
        where: { churchId_syncType: { churchId, syncType: SYNC_TYPES.FINIX_COMPLIANCE_FORMS } },
      });
      expect(state?.resultCount).toBe(1);
      expect(state?.lastSuccessfulAt).not.toBeNull();
    } finally {
      await cleanupChurch(churchId);
    }
  });

  it("test 3: failed Finix call updates lastErrorAt and observes 5-minute retry cooldown", async () => {
    const { churchId } = await setupChurch("t3");
    try {
      vi.mocked(finixClient.listComplianceFormsForMerchant).mockRejectedValueOnce(
        new Error("Finix Timeout/500 Error")
      );

      // 1st call (fails)
      await reconcileComplianceFormsForChurch(churchId);
      expect(finixClient.listComplianceFormsForMerchant).toHaveBeenCalledTimes(1);

      const state = await prisma.synchronizationState.findUnique({
        where: { churchId_syncType: { churchId, syncType: SYNC_TYPES.FINIX_COMPLIANCE_FORMS } },
      });
      expect(state?.lastSuccessfulAt).toBeNull();
      expect(state?.lastErrorAt).not.toBeNull();
      expect(state?.lastErrorCode).toContain("Error");

      // 2nd call (should be throttled by 5-minute retry cooldown)
      await reconcileComplianceFormsForChurch(churchId);
      expect(finixClient.listComplianceFormsForMerchant).toHaveBeenCalledTimes(1);
    } finally {
      await cleanupChurch(churchId);
    }
  });

  it("test 4: concurrent requests trigger exactly one Finix call", async () => {
    const { churchId } = await setupChurch("t4");
    try {
      let callCount = 0;
      vi.mocked(finixClient.listComplianceFormsForMerchant).mockImplementation(async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { _embedded: { compliance_forms: [] } };
      });

      // Run two sync attempts concurrently
      await Promise.all([
        reconcileComplianceFormsForChurch(churchId),
        reconcileComplianceFormsForChurch(churchId),
      ]);

      // Should only invoke Finix once due to the concurrency lease lock
      expect(callCount).toBe(1);
    } finally {
      await cleanupChurch(churchId);
    }
  });
});
