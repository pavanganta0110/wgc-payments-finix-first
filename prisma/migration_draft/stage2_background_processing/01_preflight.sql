-- Stage 2 background-processing migration — PREFLIGHT.
-- Run immediately before 02_migration.sql, not hours/days earlier.
-- Both checks must return ZERO rows / a clean result before proceeding.

-- 1. BackgroundJob must not already exist (this is a brand-new table).
SELECT to_regclass('"BackgroundJob"') AS should_be_null;

-- 2. FinixWebhookEvent must not already have the new Stage 2 columns
--    (confirms this preflight hasn't already been applied).
SELECT column_name FROM information_schema.columns
WHERE table_name = 'FinixWebhookEvent' AND column_name IN ('attempts', 'lockedAt', 'leaseUntil', 'workerId', 'lastErrorAt');
-- Expect: zero rows.
