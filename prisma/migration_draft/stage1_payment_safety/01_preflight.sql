-- Stage 1 payment-safety migration — PREFLIGHT.
-- Run this against the target database (sandbox, then production)
-- IMMEDIATELY before 02_migration.sql, not hours/days earlier — the whole
-- point is to catch anything written in the gap since it was last checked.
--
-- Both checks must return ZERO rows before proceeding. If either returns
-- rows, STOP — do not run 02_migration.sql. Resolve the duplicates by hand
-- (see the comment under check 1) and re-run this file until it's clean.

-- 1. Duplicate Payment.finixTransferId — the unique constraint in
--    02_migration.sql will fail outright if this returns anything.
SELECT "finixTransferId", COUNT(*) AS n, array_agg(id ORDER BY "createdAt") AS payment_ids
FROM "Payment"
WHERE "finixTransferId" IS NOT NULL
GROUP BY "finixTransferId"
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- If this ever returns rows, resolve by hand — do NOT delete blindly:
--   SELECT * FROM "DonationReceipt" WHERE "paymentId" IN ('<newer ids>');
--   SELECT * FROM "QuickBooksSyncRecord" WHERE "paymentId" IN ('<newer ids>');
--   SELECT * FROM "AplosSyncRecord" WHERE "paymentId" IN ('<newer ids>');
-- Keep the oldest row; only delete a newer duplicate once you've confirmed
-- it has no receipts/sync records/refunds pointing at it, inside an
-- explicit transaction you verify before committing:
--   BEGIN;
--   DELETE FROM "Payment" WHERE id IN ('<newer duplicate ids>');
--   COMMIT;

-- 2. RefundRequest row count — 02_migration.sql DROPs and recreates this
--    table with new required (NOT NULL) columns. Confirmed empty in both
--    production and sandbox on 2026-09-03 (the table has never been wired
--    into any application code before this migration), but re-verify here
--    every time this preflight runs — if this is ever nonzero, STOP and
--    switch to an additive ALTER TABLE approach instead of 02_migration.sql
--    as written. NOTE: sandbox has already had 02_migration.sql's effects
--    applied directly (2026-09-03) — do not re-run the DROP/CREATE TABLE
--    section of 02_migration.sql against sandbox again; it is documented
--    there for the production rollout, which has not happened yet.
SELECT COUNT(*) AS refund_request_existing_rows FROM "RefundRequest";

-- 3. Duplicate InvoicePayment.finixTransferId — same invariant as Payment,
--    added in the same pass that closed the invoice-payment orphan-recovery
--    gap. The unique constraint in 02_migration.sql will fail outright if
--    this returns anything.
SELECT "finixTransferId", COUNT(*) AS n, array_agg(id ORDER BY "createdAt") AS invoice_payment_ids
FROM "InvoicePayment"
WHERE "finixTransferId" IS NOT NULL
GROUP BY "finixTransferId"
HAVING COUNT(*) > 1
ORDER BY n DESC;

-- 4. Duplicate DonationReceipt (paymentId, version) — closes the donor-
--    facing duplicate-receipt-email race in sendDonationReceipt()
--    (generateReceipt.ts). The unique constraint in 02_migration.sql will
--    fail outright if this returns anything. Confirmed empty in sandbox on
--    2026-09-03; re-verify here every time.
SELECT "paymentId", "version", COUNT(*) AS n, array_agg(id ORDER BY "createdAt") AS receipt_ids
FROM "DonationReceipt"
GROUP BY "paymentId", "version"
HAVING COUNT(*) > 1
ORDER BY n DESC;
