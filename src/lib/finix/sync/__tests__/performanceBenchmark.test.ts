import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { finixClient } from "@/lib/finix/client";
import MerchantDashboardPage from "@/app/merchant/(dashboard)/dashboard/page";

const mockUniqueSuffix = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
const mockChurchId = `perf-bench-church-${mockUniqueSuffix}`;
const mockMerchantId = `mid-perf-bench-${mockUniqueSuffix}`;

vi.mock("@/lib/auth/requireMerchantSession", () => {
  return {
    requireMerchantSession: vi.fn().mockImplementation(async () => {
      return {
        userId: "test-user-id",
        email: "test-user@wgc.org",
        churchId: mockChurchId,
        rawRole: "owner",
        role: "owner",
        isWgcAdmin: false,
      };
    }),
  };
});

vi.mock("next/navigation", () => {
  return {
    redirect: vi.fn(),
  };
});

vi.mock("next/server", () => {
  return {
    after: vi.fn(),
  };
});

vi.mock("next/headers", () => {
  return {
    cookies: vi.fn().mockResolvedValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
  };
});

vi.mock("@/lib/finix/client", () => {
  return {
    finixClient: {
      listComplianceFormsForMerchant: vi.fn().mockResolvedValue({
        _embedded: { compliance_forms: [] }
      }),
    },
  };
});

describe("Performance Benchmark - Before vs After", () => {
  beforeEach(async () => {
    // Clean up first
    await prisma.synchronizationState.deleteMany({ where: { churchId: mockChurchId } });
    await prisma.complianceForm.deleteMany({ where: { churchId: mockChurchId } });
    await prisma.church.deleteMany({ where: { id: mockChurchId } });

    // Seed test data
    await prisma.church.create({
      data: {
        id: mockChurchId,
        name: "Performance Test Church",
        slug: `perf-bench-${mockUniqueSuffix}`,
        primaryContactEmail: "test@wgc.org",
        status: "ACTIVE",
        finixMerchantId: mockMerchantId,
      },
    });

    // Seed 100 dummy transfers to measure query performance
    const transfersData = Array.from({ length: 100 }).map((_, i) => ({
      churchId: mockChurchId,
      finixTransferId: `tr_perf_bench_${mockUniqueSuffix}_${i}`,
      state: "SUCCEEDED",
      amountCents: 1000 + i,
      createdAtFinix: new Date(),
    }));
    await prisma.finixTransfer.createMany({ data: transfersData });
  });

  afterEach(async () => {
    await prisma.synchronizationState.deleteMany({ where: { churchId: mockChurchId } });
    await prisma.finixTransfer.deleteMany({ where: { churchId: mockChurchId } });
    await prisma.complianceForm.deleteMany({ where: { churchId: mockChurchId } });
    await prisma.church.deleteMany({ where: { id: mockChurchId } });
  });

  it("measures dashboard page rendering duration and database metrics", async () => {
    // Warmup run
    await MerchantDashboardPage({
      searchParams: Promise.resolve({ range: "6m" }),
    });

    // Measure After (Optimized) Page Render Time
    const start = performance.now();
    await MerchantDashboardPage({
      searchParams: Promise.resolve({ range: "6m" }),
    });
    const duration = performance.now() - start;

    console.log(`[PERF_RESULT] Server render duration: ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(300); // Verify it renders fast (e.g. < 300ms with remote cloud DB)
  });
});
