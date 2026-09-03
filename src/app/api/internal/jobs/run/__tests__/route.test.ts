import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Proves the actual HTTP route — not just the auth helper in isolation —
 * denies an unauthenticated caller and never reaches job-claiming logic
 * to do so. Job-processing internals are mocked here; the real claim/
 * lease/backoff behavior is proven separately against the real sandbox
 * database in backgroundJobsConcurrency.realdb.test.ts.
 */

const mockClaimJobBatch = vi.fn();
const mockReclaimStaleLeases = vi.fn();
vi.mock("@/lib/jobs/backgroundJobs", () => ({
  claimJobBatch: (...args: unknown[]) => mockClaimJobBatch(...args),
  reclaimStaleLeases: (...args: unknown[]) => mockReclaimStaleLeases(...args),
  completeJob: vi.fn(),
  retryOrFailJob: vi.fn(),
}));
vi.mock("@/lib/jobs/jobHandlers", () => ({ dispatchJob: vi.fn() }));
vi.mock("@/lib/observability/paymentSafetyEvents", () => ({ logPaymentSafetyEvent: vi.fn() }));

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://x.example/api/internal/jobs/run", { method: "POST", headers });
}

async function loadRoute() {
  vi.resetModules();
  return import("../route");
}

describe("POST /api/internal/jobs/run — fail-closed at the HTTP boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReclaimStaleLeases.mockResolvedValue(0);
    mockClaimJobBatch.mockResolvedValue([]);
  });
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("correct bearer secret -> 200, and job-claiming logic actually runs", async () => {
    process.env.CRON_SECRET = "route-test-secret";
    const { POST } = await loadRoute();
    const res = await POST(req({ authorization: "Bearer route-test-secret" }));
    expect(res.status).toBe(200);
    expect(mockClaimJobBatch).toHaveBeenCalled();
  });

  it("wrong secret -> 403, and job-claiming logic never runs", async () => {
    process.env.CRON_SECRET = "route-test-secret";
    const { POST } = await loadRoute();
    const res = await POST(req({ authorization: "Bearer totally-wrong" }));
    expect(res.status).toBe(403);
    expect(mockClaimJobBatch).not.toHaveBeenCalled();
    expect(mockReclaimStaleLeases).not.toHaveBeenCalled();
  });

  it("missing Authorization header -> 401, job-claiming logic never runs — the exact 'ordinary internet request' case", async () => {
    process.env.CRON_SECRET = "route-test-secret";
    const { POST } = await loadRoute();
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(mockClaimJobBatch).not.toHaveBeenCalled();
    const body = await res.json();
    // The response must never contain the real secret in any form.
    expect(JSON.stringify(body)).not.toContain("route-test-secret");
  });

  it("CRON_SECRET unset on the server -> 401, job-claiming logic never runs, even though no error is thrown for a missing config", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await loadRoute();
    const res = await POST(req({ authorization: "Bearer anything" }));
    expect(res.status).toBe(401);
    expect(mockClaimJobBatch).not.toHaveBeenCalled();
  });

  it("a plain unauthenticated request with arbitrary junk headers cannot execute the worker", async () => {
    process.env.CRON_SECRET = "route-test-secret";
    const { POST } = await loadRoute();
    const res = await POST(
      new Request("https://x.example/api/internal/jobs/run", {
        method: "POST",
        headers: { "x-forwarded-for": "203.0.113.5", cookie: "wgc_session=fake" },
      })
    );
    expect(res.status).toBe(401);
    expect(mockClaimJobBatch).not.toHaveBeenCalled();
  });
});
