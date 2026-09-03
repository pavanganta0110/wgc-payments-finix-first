-- Stage 1 payment-safety migration — ROLLBACK.
-- Only needed if the migration must be reverted (e.g. the application
-- deploy is aborted and the OLD code — which never expects
-- Payment.finixTransferId to be unique or RefundRequest to have these
-- columns — needs to keep running against this database). Safe to run at
-- any time: everything it removes was confirmed empty/unused before
-- 02_migration.sql created it, so nothing here can lose real data AS LONG
-- AS this runs before any real RefundRequest rows have been written by the
-- new refund route. If RefundRequest already has real rows by the time you
-- need to roll back, STOP — do not run section 3; export/preserve those
-- rows first, since dropping the table here is destructive.

-- 1. Restore the plain (non-unique) index Payment.finixTransferId had
--    before this migration, and drop the unique constraint.
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_finixTransferId_key";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Payment_finixTransferId_idx" ON "Payment"("finixTransferId");

-- 2. Drop the new indexes (harmless either way — pure performance aids,
--    nothing depends on them existing for correctness).
DROP INDEX IF EXISTS "Payment_finixSubscriptionId_idx";
DROP INDEX IF EXISTS "Donor_churchId_normalizedEmail_idx";
DROP INDEX IF EXISTS "Donor_churchId_normalizedPhone_idx";
DROP INDEX IF EXISTS "FinixTransfer_churchId_state_idx";

-- 3. RefundRequest — DESTRUCTIVE. Only run this if you have verified (see
--    header above) that no real refund data has been written to it yet.
--    Restores the pre-migration scaffold shape so old code (which never
--    wrote to this table anyway) is unaffected either way.
-- DROP TABLE IF EXISTS "RefundRequest";
-- CREATE TABLE "RefundRequest" (
--     "id" TEXT NOT NULL,
--     "churchId" TEXT,
--     "originalPaymentId" TEXT,
--     "requestedByEmail" TEXT,
--     "amountCents" INTEGER,
--     "reason" TEXT,
--     "status" TEXT NOT NULL DEFAULT 'PENDING',
--     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
--     "updatedAt" TIMESTAMP(3) NOT NULL,
--     CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
-- );
-- Left commented out deliberately — uncomment only after confirming the
-- destructive precondition above. Rolling back the code without rolling
-- back this table is also fine (the old code never reads/writes
-- RefundRequest at all), so in most real rollback scenarios sections 1-2
-- are sufficient and section 3 can simply be skipped.

-- 4. Restore InvoicePayment's plain (non-unique) index, drop the unique
--    constraint. Same reasoning as section 1.
ALTER TABLE "InvoicePayment" DROP CONSTRAINT IF EXISTS "InvoicePayment_finixTransferId_key";
CREATE INDEX CONCURRENTLY IF NOT EXISTS "InvoicePayment_finixTransferId_idx" ON "InvoicePayment"("finixTransferId");

-- 5. Drop the DonationReceipt(paymentId, version) unique constraint —
--    harmless either way (rolling back the code means sendDonationReceipt()
--    reverts to its old create()-at-the-end shape, which never expected
--    this constraint to exist).
ALTER TABLE "DonationReceipt" DROP CONSTRAINT IF EXISTS "DonationReceipt_paymentId_version_key";
