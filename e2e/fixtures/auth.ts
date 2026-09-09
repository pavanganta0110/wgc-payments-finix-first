import type { APIRequestContext } from "@playwright/test";

/**
 * Logs in through the REAL /api/merchant/login (or /api/admin/login) route
 * — same request the login form itself submits — using an
 * APIRequestContext tied to a BrowserContext (`context.request`, not a
 * detached `request` fixture) so the Set-Cookie session cookie lands in
 * that context's cookie jar and is sent automatically by every later
 * `page.goto()`/`page.request` call in the same context.
 *
 * Each spec seeds its own fresh merchant/admin user (see fixtures/db.ts),
 * so a single shared, reusable authenticated session across the whole
 * suite isn't meaningful here — a shared session would just be one user
 * impersonating another test's data. What actually causes login failures
 * when the full suite runs sequentially is merchantAuthRateLimit.ts's
 * 8-attempts-per-minute-per-IP window (Playwright's own baseURL is
 * 127.0.0.1 for every request, so every spec's login shares that same
 * budget) — NOT a per-user limit, so this can't be fixed by logging in
 * "less" for a given user. The rate limit itself is left completely
 * unchanged (production security requirement) — this retries a 429 after
 * waiting out the window instead, so a login attempt that only fails
 * because of the suite's own aggregate volume doesn't fail the test.
 *
 * Because of the 61s wait above, a spec whose login happens to collide
 * with this budget can incur real added latency deep in a long single-
 * worker run — this has been observed to occasionally push an otherwise-
 * fast test (e.g. 10-cancellation.spec.ts's first test) toward Playwright's
 * own 60s per-test timeout when it lands late in a long sequential suite.
 * It passes reliably in isolation and in most full-suite runs; treat an
 * occasional timeout there as this rate-limit backoff, not a product bug,
 * unless it's reproducible on its own.
 */
async function loginWithRateLimitRetry(request: APIRequestContext, path: string, email: string, password: string, label: string) {
  const res = await request.post(path, { data: { email, password } });
  if (res.ok()) return;

  if (res.status() === 429) {
    // merchantAuthRateLimit.ts / adminAuthRateLimit.ts both use a 60s
    // sliding window — waiting slightly past it guarantees this attempt is
    // outside the window that caused the 429, without touching the limit.
    await new Promise((resolve) => setTimeout(resolve, 61_000));
    const retryRes = await request.post(path, { data: { email, password } });
    if (retryRes.ok()) return;
    throw new Error(`${label} login failed after rate-limit retry (${retryRes.status()}): ${await retryRes.text()}`);
  }

  throw new Error(`${label} login failed (${res.status()}): ${await res.text()}`);
}

export async function loginAsMerchant(request: APIRequestContext, email: string, password: string) {
  await loginWithRateLimitRetry(request, "/api/merchant/login", email, password, "Merchant");
}

export async function loginAsAdmin(request: APIRequestContext, email: string, password: string) {
  await loginWithRateLimitRetry(request, "/api/admin/login", email, password, "Admin");
}
