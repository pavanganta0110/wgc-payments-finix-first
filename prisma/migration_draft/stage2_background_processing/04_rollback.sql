-- Stage 2 background-processing migration — ROLLBACK.
-- Safe at any time: BackgroundJob is new (dropping it loses only queued
-- background work, never financial records — every BackgroundJob row is
-- re-derivable from the Payment/RefundRequest/etc. row it points at via
-- entityType/entityId, per Stage 2's reconciliation-first design). The
-- FinixWebhookEvent columns are purely additive and nullable — dropping
-- them cannot affect Stage 1 code, which never reads them.

-- 1. Drop BackgroundJob entirely (see note above — no financial data lives
--    only here).
DROP TABLE IF EXISTS "BackgroundJob";

-- 2. Drop FinixWebhookEvent's Stage 2 columns.
DROP INDEX IF EXISTS "FinixWebhookEvent_processingStatus_leaseUntil_idx";
ALTER TABLE "FinixWebhookEvent" DROP COLUMN IF EXISTS "attempts";
ALTER TABLE "FinixWebhookEvent" DROP COLUMN IF EXISTS "lockedAt";
ALTER TABLE "FinixWebhookEvent" DROP COLUMN IF EXISTS "leaseUntil";
ALTER TABLE "FinixWebhookEvent" DROP COLUMN IF EXISTS "workerId";
ALTER TABLE "FinixWebhookEvent" DROP COLUMN IF EXISTS "lastErrorAt";
