import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/finix/sync/syncPaymentInstruments", () => ({ syncPaymentInstrument: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/finix/sync/syncFees", () => ({ syncFeesForTransfer: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/settings/notificationDispatch", () => ({ notifyEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/billing/invoiceUsageLedger", () => ({ recordInvoiceUsageEvent: vi.fn().mockResolvedValue({ recorded: true, billable: false }) }));

const mockPrisma = {
  church: { findFirst: vi.fn(), findUnique: vi.fn() },
  finixTransfer: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
  payment: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({}) },
  finixPaymentInstrumentSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
  finixFee: { findMany: vi.fn().mockResolvedValue([]) },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

async function sync(data: Record<string, unknown>) {
  vi.resetModules();
  const { syncFinixDataFromWebhookEvent } = await import("../route");
  return syncFinixDataFromWebhookEvent("TRANSFER", "created", data, "evt-1", new Date("2026-10-23T12:00:00Z"));
}

const transfer = (extra: Record<string, unknown> = {}) => ({
  id: "TRx1",
  merchant: "MUunknown",
  type: "DEBIT",
  subtype: "API",
  state: "SUCCEEDED",
  amount: 5150,
  tags: {},
  ...extra,
});

describe("transfers for a merchant another environment owns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.church.findFirst.mockResolvedValue(null);
    mockPrisma.church.findUnique.mockResolvedValue(null);
    mockPrisma.finixTransfer.upsert.mockResolvedValue({});
    mockPrisma.finixTransfer.findUnique.mockResolvedValue(null);
  });

  it("is not stored when it is tagged with an organization id that doesn't exist in this database", async () => {
    await sync(transfer({ tags: { churchId: "org-from-sandbox", source: "wgc_giving_link" } }));
    expect(mockPrisma.finixTransfer.upsert).not.toHaveBeenCalled();
  });

  it("is still stored when the merchant is unknown but the tagged organization does exist here", async () => {
    mockPrisma.church.findUnique.mockResolvedValue({ id: "org-here" });
    await sync(transfer({ tags: { churchId: "org-here" } }));
    expect(mockPrisma.finixTransfer.upsert).toHaveBeenCalledTimes(1);
  });

  it("is still stored when it carries no organization tag (WGC's own platform-level rows, e.g. settlement credits)", async () => {
    await sync(transfer({ type: "CREDIT", subtype: "SETTLEMENT_PLATFORM", tags: {} }));
    expect(mockPrisma.finixTransfer.upsert).toHaveBeenCalledTimes(1);
  });

  it("is stored normally for a merchant that belongs to an organization here", async () => {
    mockPrisma.church.findFirst.mockResolvedValue({ id: "church-a" });
    await sync(transfer({ merchant: "MUknown", tags: { churchId: "church-a" } }));
    expect(mockPrisma.finixTransfer.upsert).toHaveBeenCalledTimes(1);
    expect((mockPrisma.finixTransfer.upsert.mock.calls[0][0] as any).create.churchId).toBe("church-a");
  });
});
