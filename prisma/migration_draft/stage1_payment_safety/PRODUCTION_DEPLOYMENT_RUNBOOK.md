# Stage 1 production deployment runbook

**No step here has been executed against production. This document exists so the deployment, when it happens, follows a fixed order under a human's direct control — not because any of it has already run.**

## Deployment order (forward)

```
PRODUCTION PRECHECK
  ↓
PRODUCTION DATABASE MIGRATION      (01_preflight.sql -> 02_migration.sql -> 03_verify.sql)
  ↓
VERIFY DATABASE                    (03_verify.sql — all checks must pass)
  ↓
MERGE PR #9 INTO MAIN
  ↓
VERCEL PRODUCTION DEPLOY           (automatic on merge — confirmed via `vercel inspect`:
                                     the live wgcpayments.com deployment carries the
                                     wgc-payments-live-git-main-wgcpayments.vercel.app
                                     alias and target: production)
  ↓
SMOKE TEST
  ↓
MONITOR
```

**Why the DB migration happens before the code merge, not after:** Stage 1's application code assumes the new constraints already exist the moment it starts running (`Payment.finixTransferId` unique, `InvoicePayment.finixTransferId` unique, `DonationReceipt(paymentId, version)` unique, the `RefundRequest` redesign). If the code deployed before the migration ran, every code path that depends on P2002-based concurrency safety would silently have no real constraint behind it — the exact class of bug this whole branch exists to close. The migration and the code merge belong in the same controlled deployment window, migration first.

## Rollback order (if something goes wrong after merge/deploy)

**Code first, schema only if actually necessary — never the reverse, and never automatically.**

### 1. CODE ROLLBACK — exact process

1. **Revert PR #9 / revert the Stage 1 merge commit** on `main` (`git revert -m 1 <merge-commit-sha>`, or GitHub's "Revert" button on the merged PR — produces a new commit, never a force-push or history rewrite on `main`).
2. **Wait for Vercel to redeploy** the previous application code — merging the revert to `main` triggers a new automatic production deployment of the pre-Stage-1 code, the same way the original merge did.
3. **Verify the old code is serving correctly** — check the live site, check a real request path (e.g. the donate flow, a merchant login), confirm the deployed build matches the reverted commit before doing anything else.
4. **Only then** consider whether schema rollback is actually warranted (see below) — never do it reflexively just because the code rolled back.

### 2. SCHEMA ROLLBACK — when required

Schema rollback (`04_rollback.sql`) is warranted only when the NEW constraints themselves are causing active harm to the OLD (reverted) code — concretely:

- The old code writes to a table in a shape the new unique constraint now rejects (e.g. the old code could create two `Payment` rows sharing a `finixTransferId` in some path the new code closed, and after reverting, that old path is failing with constraint-violation errors it never used to produce).
- A specific, observed production error traces directly to one of the new constraints blocking the reverted code's normal operation.

In that case, roll back **only the specific constraint causing the problem**, not the whole migration — `04_rollback.sql` is written as independent, ordered sections for exactly this reason (each section's header states what it undoes and why it's safe on its own).

### 3. SCHEMA ROLLBACK — when NOT required (the default assumption)

**Preferred principle: if the new schema is backward-compatible with the old application, leave the safe constraints in place unless there is a concrete, observed reason to remove them.** Do not roll back schema automatically just because code rolled back — the two are independent decisions.

Every constraint in this migration is additive and backward-compatible with the pre-Stage-1 code by design:

- `Payment.finixTransferId` / `InvoicePayment.finixTransferId` unique — the old code never intentionally created two `Payment` rows for the same `finixTransferId`; the constraint only rejects a state that was already a bug. Leaving it in place after a code rollback continues to protect against duplicate-payment bugs in the OLD code too.
- `DonationReceipt(paymentId, version)` unique — the old `sendDonationReceipt()` never intentionally created two rows with the same `(paymentId, version)`; this constraint is pure upside for the old code as well.
- `RefundRequest` redesign, new indexes — `RefundRequest` had zero application callers before this branch (confirmed during the original audit), so the old code cannot be affected by its shape changing. New indexes are pure performance, never a correctness constraint the old code could violate.

**In the ordinary case — code rolled back because of an application-level bug unrelated to the schema itself — leave the schema exactly as migrated.** Dropping a unique constraint the moment code rolls back re-opens the exact duplicate-payment/duplicate-receipt windows this branch was written to close, for however long the old code runs afterward.
