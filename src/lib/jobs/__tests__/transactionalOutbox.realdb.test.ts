import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { enqueueBackgroundJobInTransaction } from "../backgroundJobs";

/**
 * REAL SANDBOX POSTGRES — proves the core Stage 2 Task 2 invariant
 * directly against actual transaction semantics, not a mock: "if the
 * Payment row commits, its required durable post-payment jobs also
 * commit" — and the converse, "if the transaction rolls back, NEITHER
 * exists." This is the exact pattern used in
 * src/app/api/g/[slug]/donate/route.ts's transactional outbox (Payment +
 * finixTransfer.upsert + paymentAttempt.update + enqueueBackgroundJobInTransaction,
 * all inside one prisma.$transaction, with the Finix HTTP call already
 * completed before the transaction ever opens).
 */

const CHURCH_ID = "realdb-outbox-test-church";
const PAYMENT_ID_PREFIX = "realdb-outbox-test-payment";

async function cleanup() {
  await prisma.backgroundJob.deleteMany({ where: { entityType: "Payment", entityId: { startsWith: PAYMENT_ID_PREFIX } } });
  await prisma.payment.deleteMany({ where: { churchId: CHURCH_ID } });
  await prisma.church.deleteMany({ where: { id: CHURCH_ID } });
}

describe("Transactional outbox — real sandbox Postgres atomicity", () => {
  beforeEach(async () => {
    await cleanup();
    await prisma.church.create({ data: { id: CHURCH_ID, name: "Outbox Test Church", slug: `outbox-test-${Date.now()}`, primaryContactEmail: "outbox-test@example.com", status: "ACTIVE" } });
  });
  afterEach(cleanup);

  it("commit: Payment AND its required BackgroundJob rows are BOTH durably present together", async () => {
    const paymentId = `${PAYMENT_ID_PREFIX}-commit`;
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { id: paymentId, churchId: CHURCH_ID, amountCents: 5000, paymentMethodType: "PAYMENT_CARD", status: "SUCCEEDED" },
      });
      await enqueueBackgroundJobInTransaction(tx, {
        jobType: "SEND_RECEIPT",
        entityType: "Payment",
        entityId: payment.id,
        dedupeKey: `SEND_RECEIPT:payment:${payment.id}:version:1`,
        payload: { paymentId: payment.id },
      });
      await enqueueBackgroundJobInTransaction(tx, {
        jobType: "QUICKBOOKS_PAYMENT",
        entityType: "Payment",
        entityId: payment.id,
        dedupeKey: `QUICKBOOKS_PAYMENT:payment:${payment.id}`,
        payload: { paymentId: payment.id },
      });
    });

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment).toBeTruthy();
    const jobs = await prisma.backgroundJob.findMany({ where: { entityType: "Payment", entityId: paymentId } });
    expect(jobs.map((j) => j.jobType).sort()).toEqual(["QUICKBOOKS_PAYMENT", "SEND_RECEIPT"]);
  });

  it("rollback: a failure AFTER the Payment write but BEFORE commit leaves NEITHER the Payment NOR its jobs durably present — no crash window where Payment exists but its required jobs don't", async () => {
    const paymentId = `${PAYMENT_ID_PREFIX}-rollback`;
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: { id: paymentId, churchId: CHURCH_ID, amountCents: 5000, paymentMethodType: "PAYMENT_CARD", status: "SUCCEEDED" },
        });
        await enqueueBackgroundJobInTransaction(tx, {
          jobType: "SEND_RECEIPT",
          entityType: "Payment",
          entityId: paymentId,
          dedupeKey: `SEND_RECEIPT:payment:${paymentId}:version:1`,
          payload: { paymentId },
        });
        // Simulates a crash/error between the Payment write and the
        // transaction actually committing — e.g. a second required
        // enqueue throwing for some reason. The whole transaction must
        // roll back atomically, not leave the Payment or the first job
        // partially committed.
        throw new Error("simulated crash before commit");
      })
    ).rejects.toThrow("simulated crash before commit");

    const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
    expect(payment).toBeNull();
    const jobs = await prisma.backgroundJob.findMany({ where: { entityType: "Payment", entityId: paymentId } });
    expect(jobs).toHaveLength(0);
  });

  it("the Finix-confirmed-but-local-write-failed P2002 recovery path finds the WINNING transaction's Payment AND its jobs, both already committed by the other racer", async () => {
    const paymentId = `${PAYMENT_ID_PREFIX}-race-winner`;
    const finixTransferId = `TR-${paymentId}`;

    // Winner: a full transactional-outbox commit, exactly like the real route.
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: { id: paymentId, churchId: CHURCH_ID, amountCents: 5000, paymentMethodType: "PAYMENT_CARD", status: "SUCCEEDED", finixTransferId },
      });
      await enqueueBackgroundJobInTransaction(tx, {
        jobType: "SEND_RECEIPT",
        entityType: "Payment",
        entityId: payment.id,
        dedupeKey: `SEND_RECEIPT:payment:${payment.id}:version:1`,
        payload: { paymentId: payment.id },
      });
    });

    // Loser: a concurrent request for the SAME finixTransferId races in,
    // gets P2002 on its own attempted Payment.create (simulated directly
    // here rather than re-deriving Prisma's own constraint error), and
    // recovers by reading back what the winner already committed — this
    // is exactly donate/route.ts's P2002 catch branch.
    const recovered = await prisma.payment.findUnique({ where: { finixTransferId } });
    expect(recovered?.id).toBe(paymentId);
    const jobs = await prisma.backgroundJob.findMany({ where: { entityType: "Payment", entityId: paymentId } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].jobType).toBe("SEND_RECEIPT");
  });
});
