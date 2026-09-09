-- Stage 1 payment-safety migration — VERIFICATION.
-- Run immediately after 02_migration.sql. Every query should return the
-- indicated result; if any doesn't, stop and investigate before deploying
-- the application code that assumes these exist.

-- 1. Payment.finixTransferId is a real unique constraint (not just an index).
--    Expect: one row, contype = 'u'.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"Payment"'::regclass AND conname = 'Payment_finixTransferId_key';

-- 2. The old plain (non-unique) index on the same column is gone.
--    Expect: zero rows.
SELECT indexname FROM pg_indexes WHERE tablename = 'Payment' AND indexname = 'Payment_finixTransferId_idx';

-- 3. All five new indexes exist.
--    Expect: five rows.
SELECT indexname FROM pg_indexes
WHERE indexname IN (
  'Payment_finixSubscriptionId_idx',
  'Donor_churchId_normalizedEmail_idx',
  'Donor_churchId_normalizedPhone_idx',
  'FinixTransfer_churchId_state_idx',
  'RefundRequest_finixTransferId_clientRefundId_key'
)
ORDER BY indexname;

-- 4. RefundRequest has the expected new columns and NOT NULL shape.
--    Expect: churchId, finixTransferId, clientRefundId all "NO" (not
--    nullable); originalPaymentId, requestedByUserId, requestedByEmail,
--    amountCents, reason, finixReversalId, failureMessage all "YES".
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'RefundRequest'
ORDER BY ordinal_position;

-- 5. Sanity: inserting two rows with the same (finixTransferId,
--    clientRefundId) must be rejected by the new unique constraint —
--    proves the constraint is real and enforced, not just declared. Run
--    inside a transaction you roll back, never commit test data.
BEGIN;
INSERT INTO "RefundRequest" (id, "churchId", "finixTransferId", "clientRefundId", status, "updatedAt")
VALUES ('verify-test-1', 'verify-church', 'verify-transfer', 'verify-click', 'PENDING', now());
-- This second insert MUST fail with a unique_violation (23505):
INSERT INTO "RefundRequest" (id, "churchId", "finixTransferId", "clientRefundId", status, "updatedAt")
VALUES ('verify-test-2', 'verify-church', 'verify-transfer', 'verify-click', 'PENDING', now());
ROLLBACK;

-- 6. Payment table row count unchanged by the migration (no data loss).
--    Compare this number against what 01_preflight.sql's environment had
--    before the migration ran.
SELECT COUNT(*) AS payment_row_count FROM "Payment";

-- 7. InvoicePayment.finixTransferId is a real unique constraint.
--    Expect: one row, contype = 'u'.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"InvoicePayment"'::regclass AND conname = 'InvoicePayment_finixTransferId_key';

-- 8. The old plain index on InvoicePayment.finixTransferId is gone.
--    Expect: zero rows.
SELECT indexname FROM pg_indexes WHERE tablename = 'InvoicePayment' AND indexname = 'InvoicePayment_finixTransferId_idx';

-- 9. InvoicePayment row count unchanged by the migration (no data loss).
SELECT COUNT(*) AS invoice_payment_row_count FROM "InvoicePayment";

-- 10. DonationReceipt(paymentId, version) is a real unique constraint.
--     Expect: one row, contype = 'u'.
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = '"DonationReceipt"'::regclass AND conname = 'DonationReceipt_paymentId_version_key';

-- 11. Sanity: inserting two DonationReceipt rows with the same
--     (paymentId, version) must be rejected. DonationReceipt.paymentId has
--     a real FK to Payment, so this uses an actual existing Payment id
--     (picked dynamically — skip this check entirely if the environment
--     has zero Payment rows). Run inside a transaction you roll back,
--     never commit test data.
BEGIN;
INSERT INTO "DonationReceipt" (id, "paymentId", "churchId", version, "receiptNumber", "paymentAmountCentsSnapshot", "acknowledgmentTextSnapshot", "createdAt")
SELECT 'verify-receipt-1', id, "churchId", 999999, 'VERIFY-1', 100, 'test', now() FROM "Payment" LIMIT 1;
-- This second insert (same paymentId/version) MUST fail with a
-- unique_violation (23505):
INSERT INTO "DonationReceipt" (id, "paymentId", "churchId", version, "receiptNumber", "paymentAmountCentsSnapshot", "acknowledgmentTextSnapshot", "createdAt")
SELECT 'verify-receipt-2', id, "churchId", 999999, 'VERIFY-1', 100, 'test', now() FROM "Payment" LIMIT 1;
ROLLBACK;

-- 12. DonationReceipt row count unchanged by the migration (no data loss).
SELECT COUNT(*) AS donation_receipt_row_count FROM "DonationReceipt";
