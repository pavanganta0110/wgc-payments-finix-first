import { timingSafeEqual } from "crypto";

/**
 * Fail-closed authentication for every internal worker/reconciliation
 * route (job claiming, job processing, webhook processing,
 * reconciliation). These routes can trigger real background execution —
 * they must never be reachable by an ordinary unauthenticated internet
 * request, and a missing CRON_SECRET must deny access, never silently
 * allow it (that would recreate the same class of problem as the
 * historical test-webhook/debug routes removed in Stage 1).
 *
 * Mandatory truth table:
 *   CRON_SECRET set + correct bearer token   -> allowed
 *   CRON_SECRET set + wrong/missing token    -> denied (401/403)
 *   CRON_SECRET NOT set in the environment   -> denied (401), always —
 *     never `if (!CRON_SECRET) { allow }`.
 */
export class WorkerAuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403
  ) {
    super(message);
    this.name = "WorkerAuthError";
  }
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false — comparing against a fixed-length hash of both sides sidesteps
  // that without leaking length via a short-circuit return, so a caller
  // can't use timing to learn the secret's length either.
  const hashA = Buffer.from(a.length.toString());
  const hashB = Buffer.from(b.length.toString());
  if (hashA.length !== hashB.length || !timingSafeEqual(hashA, hashB)) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Throws WorkerAuthError (never silently returns false) on any failure —
 * callers should let this propagate and map it to the HTTP response, so
 * there's no code path that can accidentally treat "auth check threw" as
 * "auth check passed."
 */
export function requireWorkerAuth(req: Request): void {
  // FAIL CLOSED: an unset CRON_SECRET denies every request, unconditionally.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new WorkerAuthError("Worker authentication is not configured on this deployment.", 401);
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    throw new WorkerAuthError("Missing Authorization header.", 401);
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    throw new WorkerAuthError("Authorization header must be a Bearer token.", 401);
  }

  const provided = match[1];
  if (!constantTimeEquals(provided, secret)) {
    throw new WorkerAuthError("Invalid worker credential.", 403);
  }
}
