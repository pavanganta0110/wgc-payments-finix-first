import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

/**
 * The one shared implementation both refund routes call (see cold-review
 * defect #3 — the invoice refund route previously read its refundable
 * balance with a plain, unlocked query and never accounted for other
 * PENDING RefundRequest rows, so two concurrent partial refunds could
 * together exceed the real balance). This file proves the concurrency
 * guarantee directly against the shared function, independent of either
 * route.
 *
 * The fake $transaction below serializes calls per finixTransferId with a
 * real mutex — mirroring exactly what Postgres's `SELECT ... FOR UPDATE`
 * guarantees in production: whichever caller acquires the lock first runs
 * its full read-recompute-write to completion before the next one starts.
 */

function makeP2002() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "5.16.1" });
}

const TRANSFER_ID = "TR-concurrency-test";
const CHURCH_ID = "church-a";
const ORIGINAL_AMOUNT_CENTS = 10000; // $100

function makeFakePrisma() {
  const refundRequests = new Map<string, { id: string; finixTransferId: string; clientRefundId: string; amountCents: number | null; status: string }>();
  let nextId = 1;
  const locks = new Map<string, Promise<unknown>>();

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prior = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    locks.set(key, prior.then(() => gate));
    await prior;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: "finix-transfer-row" }]),
    finixTransfer: {
      findFirst: vi.fn().mockResolvedValue({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, type: "TRANSFER", state: "SUCCEEDED", amountCents: ORIGINAL_AMOUNT_CENTS, finixMerchantId: "MU1" }),
    },
    finixRefundOrReversal: { findMany: vi.fn().mockResolvedValue([]) },
    bankReturn: { findMany: vi.fn().mockResolvedValue([]) },
    refundRequest: {
      findMany: vi.fn(async ({ where }: any) => [...refundRequests.values()].filter((r) => r.finixTransferId === where.finixTransferId && r.status === where.status)),
      create: vi.fn(async ({ data }: any) => {
        const key = `${data.finixTransferId}:${data.clientRefundId}`;
        if ([...refundRequests.values()].some((r) => `${r.finixTransferId}:${r.clientRefundId}` === key)) throw makeP2002();
        const row = { id: `refund-${nextId++}`, ...data };
        refundRequests.set(row.id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const compound = where.finixTransferId_clientRefundId;
        return [...refundRequests.values()].find((r) => r.finixTransferId === compound.finixTransferId && r.clientRefundId === compound.clientRefundId) ?? null;
      }),
    },
  };

  const prisma = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => withLock(TRANSFER_ID, () => fn(tx))),
  };

  return { prisma, refundRequests };
}

let fake: ReturnType<typeof makeFakePrisma>;
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return fake.prisma;
  },
}));

beforeEach(() => {
  fake = makeFakePrisma();
});

describe("claimRefundRequestWithBalanceLock — concurrent refund reservation", () => {
  it("$100 original, concurrent $70 + $70: only one reserves/succeeds", async () => {
    const { claimRefundRequestWithBalanceLock, RefundIneligibleError, RefundAmountError } = await import("../refundRequestClaim");

    const results = await Promise.allSettled([
      claimRefundRequestWithBalanceLock({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, clientRefundId: "click-A", requestedAmountCents: 7000 }),
      claimRefundRequestWithBalanceLock({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, clientRefundId: "click-B", requestedAmountCents: 7000 }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(RefundAmountError);
    // Confirm it's the balance check that rejected it, not some other error.
    expect(rejected[0].reason).not.toBeInstanceOf(RefundIneligibleError);
  });

  it("$100 original, concurrent $30 + $40: both may proceed since $100 remains available", async () => {
    const { claimRefundRequestWithBalanceLock } = await import("../refundRequestClaim");

    const results = await Promise.allSettled([
      claimRefundRequestWithBalanceLock({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, clientRefundId: "click-C", requestedAmountCents: 3000 }),
      claimRefundRequestWithBalanceLock({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, clientRefundId: "click-D", requestedAmountCents: 4000 }),
    ]);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(fake.refundRequests.size).toBe(2);
  });

  it("same clientRefundId x100 concurrent calls: exactly one fresh RefundRequest, every other call recovers the SAME row via P2002", async () => {
    const { claimRefundRequestWithBalanceLock } = await import("../refundRequestClaim");

    const calls = Array.from({ length: 100 }, () =>
      claimRefundRequestWithBalanceLock({ finixTransferId: TRANSFER_ID, churchId: CHURCH_ID, clientRefundId: "click-same", requestedAmountCents: 5000 })
    );
    const results = await Promise.all(calls);

    expect(fake.refundRequests.size).toBe(1);
    const freshClaims = results.filter((r) => r.isFreshClaim);
    expect(freshClaims).toHaveLength(1);
    const ids = new Set(results.map((r) => r.refundRequest.id));
    expect(ids.size).toBe(1);
  });
});
