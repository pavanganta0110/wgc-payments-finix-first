# Stage 3 evidence: sandbox DB connection pool exhaustion under parallel test load

**Recorded 2026-09-03. Finding only — no tuning done, no production assumption made.**

## What was observed

Running the full Vitest suite in parallel against the sandbox Supabase project produces:

```
FATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15
```

Confirmed reproducible in 3 specific test files, all dashboard/reporting-aggregate tests that issue many concurrent DB queries per test:

- `src/lib/reports/__tests__/dashboardAggregates.test.ts`
- `src/lib/reports/__tests__/dashboardScaleRegression.test.ts`
- `src/lib/finix/sync/__tests__/performanceBenchmark.test.ts`

Confirmed via `--no-file-parallelism` isolation testing that this is genuinely about aggregate connection pressure, not a single runaway query.

## What this does and does NOT prove

- **Does prove:** the sandbox Supabase project's session-mode pooler is configured with `pool_size: 15`, and WGC's own dashboard/reporting query patterns can exhaust that budget under parallel load in this specific environment.
- **Does NOT prove** anything about production's pooler mode, pool size, compute tier, or connection budget. No assumption about production has been made from this sandbox observation, and none should be — this is explicitly flagged so nobody carries this number into a production capacity decision by accident.

## Stage 3 requirements (to add, not to act on now)

Before this can be tuned or relied upon, Stage 3 must independently verify, against **production**, not sandbox:

- Actual production Supabase pooler mode (session vs. transaction vs. statement)
- Actual production pool size
- Production compute tier
- Production max DB connections
- Prisma `connection_limit` as actually configured for the production deployment
- Vercel function concurrency (how many concurrent serverless instances can each hold their own DB connection)
- Dashboard/reporting query connection pressure under real production load
- Payment checkout path's own connection budget under real production load

## Priority principle to carry into Stage 3

**Payment checkout must get priority over dashboard/reporting workload.** A donor trying to give should never be blocked or degraded by a merchant staring at a dashboard chart. Whatever connection-pool strategy Stage 3 lands on (separate pools, priority queuing, read replicas for reporting, etc.) must protect the checkout path first.
