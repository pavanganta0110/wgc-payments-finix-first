-- Stage 2 background-processing migration.
-- Run 01_preflight.sql immediately before this. Apply to SANDBOX first,
-- verify with 03_verify.sql, run the full Stage 2 test pass, THEN apply to
-- production the same way — never `prisma db push` against production.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so this
-- file must be run statement-by-statement (autocommit), not wrapped in a
-- single BEGIN/COMMIT. BackgroundJob is a brand-new, empty table, so its
-- own indexes could be created non-concurrently with zero real risk — but
-- CONCURRENTLY is used throughout anyway for consistency with the
-- FinixWebhookEvent ALTER TABLE below, which touches a live table.

-- =========================================================================
-- 1. BackgroundJob — new table
-- =========================================================================
CREATE TABLE "BackgroundJob" (
    "id"          TEXT NOT NULL,
    "jobType"     TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'PENDING',
    "entityType"  TEXT NOT NULL,
    "entityId"    TEXT NOT NULL,
    "dedupeKey"   TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "attempts"    INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextRunAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt"    TIMESTAMP(3),
    "leaseUntil"  TIMESTAMP(3),
    "workerId"    TEXT,
    "lastError"   TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "failedAt"    TIMESTAMP(3),

    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_dedupeKey_key" ON "BackgroundJob"("dedupeKey");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_status_nextRunAt_idx" ON "BackgroundJob"("status", "nextRunAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_status_leaseUntil_idx" ON "BackgroundJob"("status", "leaseUntil");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_entityType_entityId_idx" ON "BackgroundJob"("entityType", "entityId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "BackgroundJob_jobType_status_idx" ON "BackgroundJob"("jobType", "status");

-- =========================================================================
-- 2. FinixWebhookEvent — extend for the Stage 2 fast-ack lifecycle
--    (RECEIVED -> PROCESSING -> PROCESSED | FAILED), stale-PROCESSING
--    recovery, and attempt/latency observability. All new columns are
--    nullable/defaulted, so this is purely additive — zero effect on
--    existing rows or the Stage 1 code that already writes to this table.
-- =========================================================================
ALTER TABLE "FinixWebhookEvent" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FinixWebhookEvent" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "FinixWebhookEvent" ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3);
ALTER TABLE "FinixWebhookEvent" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "FinixWebhookEvent" ADD COLUMN IF NOT EXISTS "lastErrorAt" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "FinixWebhookEvent_processingStatus_leaseUntil_idx" ON "FinixWebhookEvent"("processingStatus", "leaseUntil");
