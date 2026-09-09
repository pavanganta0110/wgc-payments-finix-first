-- Stage 1 payment-safety migration.
-- Run 01_preflight.sql immediately before this and confirm both checks
-- returned zero rows. Apply to SANDBOX first, verify with 03_verify.sql,
-- run the full Stage 1 test/E2E/sandbox-Finix pass, THEN apply to
-- production the same way — never `prisma db push`.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this
-- file must be run statement-by-statement (autocommit), not wrapped in a
-- single BEGIN/COMMIT. At today's actual table sizes (Payment: 19 rows in
-- production, 0 in RefundRequest) a plain blocking CREATE INDEX would also
-- be instantaneous — CONCURRENTLY is used anyway as the durable, safe-at-
-- any-future-size form, per the "safe PostgreSQL migration technique"
-- instruction. Off-peak, never Sunday morning, regardless.

-- =========================================================================
-- 1. Payment.finixTransferId -> UNIQUE
-- =========================================================================
-- Build the unique index without locking writes, then attach it as a
-- constraint (fast metadata-only operation once the index already proves
-- uniqueness), then drop the now-redundant plain index it replaces.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "Payment_finixTransferId_key" ON "Payment"("finixTransferId");

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_finixTransferId_key" UNIQUE USING INDEX "Payment_finixTransferId_key";

DROP INDEX IF EXISTS "Payment_finixTransferId_idx";

-- =========================================================================
-- 2. New indexes matching Stage 1's actual query patterns
-- =========================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_finixSubscriptionId_idx" ON "Payment"("finixSubscriptionId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "Donor_churchId_normalizedEmail_idx" ON "Donor"("churchId", "normalizedEmail");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Donor_churchId_normalizedPhone_idx" ON "Donor"("churchId", "normalizedPhone");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "FinixTransfer_churchId_state_idx" ON "FinixTransfer"("churchId", "state");

-- =========================================================================
-- 3. RefundRequest — was an unused scaffold (zero application references,
--    confirmed empty in both databases by 01_preflight.sql immediately
--    before this ran) — replaced with the shape the refund route now
--    actually writes to. DROP+CREATE rather than ALTER since the table is
--    empty and several columns change from nullable to required.
-- =========================================================================
DROP TABLE IF EXISTS "RefundRequest";

CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "originalPaymentId" TEXT,
    "finixTransferId" TEXT NOT NULL,
    "clientRefundId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "requestedByEmail" TEXT,
    "amountCents" INTEGER,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "finixReversalId" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RefundRequest_finixTransferId_clientRefundId_key" ON "RefundRequest"("finixTransferId", "clientRefundId");
CREATE INDEX "RefundRequest_churchId_idx" ON "RefundRequest"("churchId");
CREATE INDEX "RefundRequest_originalPaymentId_idx" ON "RefundRequest"("originalPaymentId");
CREATE INDEX "RefundRequest_finixTransferId_status_idx" ON "RefundRequest"("finixTransferId", "status");

-- FinixRefundOrReversal.refundRequestId already existed as a plain column
-- (was unused, pointing at nothing) — no schema change needed there, only
-- confirming it's now actually populated by the application code.

-- =========================================================================
-- 4. InvoicePayment.finixTransferId -> UNIQUE
--    Same invariant as Payment.finixTransferId above (see that section's
--    comment) — added once the invoice-payment webhook orphan-recovery
--    path needed it. Already applied to sandbox on 2026-09-03; still
--    pending for production.
-- =========================================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "InvoicePayment_finixTransferId_key" ON "InvoicePayment"("finixTransferId");

ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_finixTransferId_key" UNIQUE USING INDEX "InvoicePayment_finixTransferId_key";

DROP INDEX IF EXISTS "InvoicePayment_finixTransferId_idx";

-- =========================================================================
-- 5. DonationReceipt(paymentId, version) -> UNIQUE
--    Closes a real donor-facing duplicate-receipt-email race: two
--    concurrent calls to sendDonationReceipt() for the same Payment (e.g.
--    both sides of a Payment.finixTransferId P2002 recovery in
--    checkoutService.ts) could previously both send a real email before
--    either had written a DonationReceipt row — nothing serialized them.
--    Already applied to sandbox on 2026-09-03; still pending for
--    production.
-- =========================================================================
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "DonationReceipt_paymentId_version_key" ON "DonationReceipt"("paymentId", "version");

ALTER TABLE "DonationReceipt" ADD CONSTRAINT "DonationReceipt_paymentId_version_key" UNIQUE USING INDEX "DonationReceipt_paymentId_version_key";
