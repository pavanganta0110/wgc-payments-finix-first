-- ============================================================================
-- Merchant lifecycle emails — additive schema change
-- ============================================================================
--
-- Adds the "MerchantLifecycleEmail" table used by the daily cron at
-- /api/cron/merchant-lifecycle-emails (src/lib/lifecycle/). One row per
-- (church, emailType) tracks how far through the nudge cadence it is.
--
-- Additive only: one CREATE TABLE, one unique index, one plain index. No
-- existing table is touched, so it is safe to run before or after the deploy.
-- Idempotent (IF NOT EXISTS), so re-running it or letting `prisma db push`
-- (part of `npm run build`) reconcile it afterwards is harmless.
--
-- Run this BEFORE the cron entry in vercel.json goes live; otherwise the
-- cron's first run fails on a missing table.

CREATE TABLE IF NOT EXISTS "MerchantLifecycleEmail" (
    "id" TEXT NOT NULL,
    "churchId" TEXT NOT NULL,
    "emailType" TEXT NOT NULL,
    "sequenceStep" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantLifecycleEmail_pkey" PRIMARY KEY ("id")
);

-- The duplicate-prevention constraint: at most one row per church per email type.
CREATE UNIQUE INDEX IF NOT EXISTS "MerchantLifecycleEmail_churchId_emailType_key"
    ON "MerchantLifecycleEmail"("churchId", "emailType");

CREATE INDEX IF NOT EXISTS "MerchantLifecycleEmail_churchId_idx"
    ON "MerchantLifecycleEmail"("churchId");
