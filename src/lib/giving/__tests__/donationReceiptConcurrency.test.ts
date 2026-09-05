import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * A donor receiving two receipts can reasonably believe they were charged
 * twice. sendDonationReceipt() previously read the "latest" DonationReceipt
 * version unlocked, then sent the real email BEFORE writing any row — two
 * concurrent calls for the same Payment (e.g. both sides of the
 * Payment.finixTransferId P2002 race in checkoutService.ts, where the loser
 * recovers the winner's row and then also calls sendDonationReceipt) could
 * both send a real donor-facing email. The fix: DonationReceipt now has a
 * real DB unique constraint on (paymentId, version) — see schema.prisma —
 * and the function claims a row via that constraint BEFORE ever sending the
 * email, not after.
 *
 * This test proves the invariant directly: 100 concurrent calls for the
 * SAME Payment must result in exactly one email sent and one non-superseded
 * DonationReceipt row, using a real DB unique-constraint-shaped fake, not a
 * timing assumption.
 */

function makeP2002() {
  const err = new Error("Unique constraint failed") as Error & { code: string };
  err.code = "P2002";
  return err;
}

type FakeReceiptRow = { id: string; paymentId: string; version: number; sentAt: Date | null; supersededAt: Date | null; [key: string]: unknown };

function makeFakePrisma() {
  const receipts = new Map<string, FakeReceiptRow>(); // key: `${paymentId}:${version}`
  let nextId = 1;

  const payment = { id: "payment-1", churchId: "church-1", donorId: "donor-1", finixPaymentInstrumentId: null, receiptNumber: null, createdAt: new Date(), donationAmountCents: 5000, amountCents: 5000, goodsServicesProvided: false, goodsServicesDescription: null, goodsServicesFairMarketValueCents: null, recordedContributionAmountCents: null, fundName: null, isAnonymous: false, finixTransferId: "TR1", paymentMethodType: "PAYMENT_CARD" };
  const church = { id: "church-1", name: "Test Church", receiptNumberPrefix: "TC", statementSenderName: null, logoUrl: null, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null, supportEmail: null, primaryContactEmail: "org@example.com", phone: null, website: null, taxId: null };
  const donor = { id: "donor-1", name: "Jane Doe", email: "donor@example.com", anonymousPreference: false, addressLine1: null, addressLine2: null, city: null, state: null, postalCode: null };

  const prisma = {
    payment: {
      findFirst: vi.fn().mockResolvedValue(payment),
      update: vi.fn().mockResolvedValue(payment),
    },
    church: { findUnique: vi.fn().mockResolvedValue(church) },
    donor: { findUnique: vi.fn().mockResolvedValue(donor) },
    finixPaymentInstrumentSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
    donationReceipt: {
      findFirst: vi.fn(async ({ where }: { where: { paymentId: string } }) => {
        const matching = [...receipts.values()].filter((r) => r.paymentId === where.paymentId);
        if (matching.length === 0) return null;
        return matching.reduce((a, b) => (a.version > b.version ? a : b));
      }),
      create: vi.fn(async ({ data }: { data: Partial<FakeReceiptRow> & { paymentId: string; version: number } }) => {
        const key = `${data.paymentId}:${data.version}`;
        if (receipts.has(key)) throw makeP2002();
        const row = { id: `receipt-${nextId++}`, sentAt: null, supersededAt: null, ...data } as FakeReceiptRow;
        receipts.set(key, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<FakeReceiptRow> }) => {
        const row = [...receipts.values()].find((r) => r.id === where.id);
        Object.assign(row!, data);
        return row;
      }),
    },
  };

  return { prisma, receipts };
}

let fake: ReturnType<typeof makeFakePrisma>;
const mockSendWgcEmail = vi.fn();

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.prisma;
  },
}));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: vi.fn().mockResolvedValue(Buffer.from("pdf")) }));
vi.mock("@/lib/email", () => ({ sendWgcEmail: (...args: unknown[]) => mockSendWgcEmail(...args) }));
vi.mock("@/lib/settings/receiptDefaults", () => ({
  resolveReceiptSettings: () => ({ subjectTemplate: "Thank you", header: null, footer: null, disclaimer: "disclaimer", thankYouMessage: "Thanks!", showFund: false, showDonationReference: false, showAddress: false, showEmail: false, showPhone: false, showWebsite: false, showTaxId: false, showPaymentMethodLastFour: false }),
}));
vi.mock("@/lib/settings/acknowledgmentDefaults", () => ({ resolveAcknowledgmentText: () => "ack text" }));
vi.mock("@/lib/giving/receiptNumber", () => ({ generateReceiptNumber: () => "TC-0001" }));
vi.mock("@/lib/giving/goodsServices", () => ({ computeRecordedContributionAmountCents: (a: number) => a }));
vi.mock("@/lib/givingLinks/attempts", () => ({ describeInstrumentType: () => "Card" }));
vi.mock("@/lib/dashboardAudit", () => ({ logDashboardAction: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/giving/pdf/DonationReceiptPdf", () => ({ DonationReceiptPdf: () => null }));
vi.mock("@/lib/format", () => ({ formatCents: (c: number) => `$${(c / 100).toFixed(2)}` }));
vi.mock("@/lib/formatPersonName", () => ({ formatPersonName: (n: string) => n }));

beforeEach(() => {
  fake = makeFakePrisma();
  mockSendWgcEmail.mockReset();
  mockSendWgcEmail.mockResolvedValue({ success: true });
});

describe("sendDonationReceipt — concurrency: one Payment, one logical receipt", () => {
  it("100 competing attempts for the SAME payment result in exactly one email sent and one non-superseded DonationReceipt row", async () => {
    const { sendDonationReceipt } = await import("../generateReceipt");

    const calls = Array.from({ length: 100 }, () => sendDonationReceipt("payment-1", "church-1"));
    const results = await Promise.all(calls);

    expect(mockSendWgcEmail).toHaveBeenCalledTimes(1);

    const nonDuplicate = results.filter((r) => !r.duplicate);
    expect(nonDuplicate).toHaveLength(1);
    const duplicates = results.filter((r) => r.duplicate);
    expect(duplicates).toHaveLength(99);

    // Exactly one logical (non-superseded) receipt row for this payment.
    expect(fake.receipts.size).toBe(1);
    const [onlyReceipt] = [...fake.receipts.values()];
    expect(onlyReceipt.sentAt).toBeTruthy();
    expect(onlyReceipt.supersededAt).toBeFalsy();
  });

  it("a genuinely later resend (after the first is fully committed) is NOT treated as a duplicate — gets a new version and sends a new email", async () => {
    const { sendDonationReceipt } = await import("../generateReceipt");

    const first = await sendDonationReceipt("payment-1", "church-1");
    expect(first.duplicate).toBe(false);
    expect(first.version).toBe(1);

    const second = await sendDonationReceipt("payment-1", "church-1", "admin-1");
    expect(second.duplicate).toBe(false);
    expect(second.version).toBe(2);

    expect(mockSendWgcEmail).toHaveBeenCalledTimes(2);
    expect(fake.receipts.size).toBe(2);

    // The first version is now superseded, the second is the current one.
    const v1 = fake.receipts.get("payment-1:1");
    const v2 = fake.receipts.get("payment-1:2");
    expect(v1?.supersededAt).toBeTruthy();
    expect(v2?.supersededAt).toBeFalsy();
  });
});
