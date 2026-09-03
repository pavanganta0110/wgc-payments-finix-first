-- Stage 2 background-processing migration — VERIFICATION.

-- 1. BackgroundJob exists with the expected unique constraint.
SELECT conname, contype FROM pg_constraint WHERE conrelid = '"BackgroundJob"'::regclass AND conname = 'BackgroundJob_dedupeKey_key';
-- Expect: one row, contype = 'u'.

-- 2. All BackgroundJob indexes exist.
SELECT indexname FROM pg_indexes WHERE tablename = 'BackgroundJob' ORDER BY indexname;
-- Expect: BackgroundJob_pkey, BackgroundJob_dedupeKey_key,
-- BackgroundJob_status_nextRunAt_idx, BackgroundJob_status_leaseUntil_idx,
-- BackgroundJob_entityType_entityId_idx, BackgroundJob_jobType_status_idx.

-- 3. Sanity: inserting two rows with the same dedupeKey must be rejected.
--    Run inside a transaction you roll back, never commit test data.
BEGIN;
INSERT INTO "BackgroundJob" (id, "jobType", "entityType", "entityId", "dedupeKey", "payloadJson", "updatedAt")
VALUES ('verify-job-1', 'TEST', 'Test', 'test-1', 'verify:dedupe:key', '{}'::jsonb, now());
-- This second insert MUST fail with a unique_violation (23505):
INSERT INTO "BackgroundJob" (id, "jobType", "entityType", "entityId", "dedupeKey", "payloadJson", "updatedAt")
VALUES ('verify-job-2', 'TEST', 'Test', 'test-1', 'verify:dedupe:key', '{}'::jsonb, now());
ROLLBACK;

-- 4. FinixWebhookEvent's new columns exist.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'FinixWebhookEvent' AND column_name IN ('attempts', 'lockedAt', 'leaseUntil', 'workerId', 'lastErrorAt')
ORDER BY column_name;
-- Expect: 5 rows.

-- 5. FinixWebhookEvent row count unchanged by the migration (no data loss).
SELECT COUNT(*) AS finix_webhook_event_row_count FROM "FinixWebhookEvent";
