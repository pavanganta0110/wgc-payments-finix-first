import { describe, it, expect, vi } from "vitest";

const mockPrisma: any = {
  smsAddonSubscription: { findMany: vi.fn().mockResolvedValue([]) },
  church: { findMany: vi.fn().mockResolvedValue([{ id: "gone-1" }]) },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

describe("detectSmsOverages", () => {
  it("never checks a terminated organization", async () => {
    const { detectSmsOverages } = await import("../smsAddonOverageDetection");
    await detectSmsOverages(new Date("2026-03-15T10:00:00Z"));
    expect(mockPrisma.smsAddonSubscription.findMany.mock.calls[0][0].where).toEqual({ status: "ACTIVE", organizationId: { notIn: ["gone-1"] } });
  });
});
