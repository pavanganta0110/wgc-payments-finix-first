import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/requireMerchantSession", () => ({ requireMerchantSession: () => mockAuth() }));
vi.mock("@/lib/auth/viewScope", () => ({ resolveViewScope: vi.fn() }));
vi.mock("@/lib/auth/scopes", () => ({ buildFinixTransferScope: vi.fn().mockResolvedValue({ churchId: "church-1" }) }));
const mockPrisma = vi.hoisted(() => ({ finixTransfer: { findFirst: vi.fn() }, payment: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
const mockRender = vi.fn();
vi.mock("@/lib/giving/generateReceipt", () => ({ renderDonationReceiptPdfForPayment: (...a: unknown[]) => mockRender(...a) }));

const params = { params: Promise.resolve({ transferId: "TR_1" }) };

async function GET() {
  vi.resetModules();
  const mod = await import("@/app/api/merchant/transactions/payments/[transferId]/receipt-view/route");
  return mod.GET(new Request("http://x"), params);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "u1", churchId: "church-1" });
  mockPrisma.finixTransfer.findFirst.mockResolvedValue({ finixTransferId: "TR_1" });
  mockPrisma.payment.findFirst.mockResolvedValue({ id: "pay-1" });
  mockRender.mockResolvedValue({ pdf: Buffer.from("%PDF-1.4 test"), fileName: "receipt-RCPT-1.pdf" });
});

describe("GET receipt-view", () => {
  it("returns the receipt PDF inline for a payment the user can see, without needing a payer email", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="receipt-RCPT-1.pdf"');
    expect(mockRender).toHaveBeenCalledWith("pay-1", "church-1");
  });

  it("looks the payment up only within the session's own organization", async () => {
    await GET();
    expect(mockPrisma.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { finixTransferId: "TR_1", churchId: "church-1" } }));
  });

  it("404s a payment outside the user's scope and never renders", async () => {
    mockPrisma.finixTransfer.findFirst.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("404s a transfer that has no payment record", async () => {
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    expect((await GET()).status).toBe(404);
    expect(mockRender).not.toHaveBeenCalled();
  });
});
