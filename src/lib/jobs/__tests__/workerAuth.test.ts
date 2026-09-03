import { describe, it, expect, afterEach } from "vitest";
import { requireWorkerAuth, WorkerAuthError } from "../workerAuth";

const ORIGINAL_SECRET = process.env.CRON_SECRET;

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://x.example/api/internal/jobs/run", { method: "POST", headers });
}

describe("requireWorkerAuth — fail-closed worker authentication", () => {
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL_SECRET;
  });

  it("correct secret -> allowed (does not throw)", () => {
    process.env.CRON_SECRET = "test-secret-value-12345";
    expect(() => requireWorkerAuth(req({ authorization: "Bearer test-secret-value-12345" }))).not.toThrow();
  });

  it("wrong secret -> denied (403)", () => {
    process.env.CRON_SECRET = "test-secret-value-12345";
    let caught: unknown;
    try {
      requireWorkerAuth(req({ authorization: "Bearer wrong-value" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerAuthError);
    expect((caught as WorkerAuthError).status).toBe(403);
  });

  it("missing Authorization header -> denied (401)", () => {
    process.env.CRON_SECRET = "test-secret-value-12345";
    let caught: unknown;
    try {
      requireWorkerAuth(req());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerAuthError);
    expect((caught as WorkerAuthError).status).toBe(401);
  });

  it("Authorization header present but not a Bearer token -> denied (401)", () => {
    process.env.CRON_SECRET = "test-secret-value-12345";
    let caught: unknown;
    try {
      requireWorkerAuth(req({ authorization: "Basic dGVzdDp0ZXN0" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerAuthError);
    expect((caught as WorkerAuthError).status).toBe(401);
  });

  it("CRON_SECRET unset on the server -> ALWAYS denied, even with a plausible-looking bearer token — never a silent allow", () => {
    delete process.env.CRON_SECRET;
    let caught: unknown;
    try {
      requireWorkerAuth(req({ authorization: "Bearer anything-at-all" }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerAuthError);
    expect((caught as WorkerAuthError).status).toBe(401);
  });

  it("CRON_SECRET set to an empty string is treated as unset -> denied", () => {
    process.env.CRON_SECRET = "";
    let caught: unknown;
    try {
      requireWorkerAuth(req({ authorization: "Bearer " }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WorkerAuthError);
    expect((caught as WorkerAuthError).status).toBe(401);
  });

  it("an ordinary internet request with no Authorization header at all cannot pass, regardless of other headers present", () => {
    process.env.CRON_SECRET = "test-secret-value-12345";
    const ordinaryRequest = new Request("https://x.example/api/internal/jobs/run", {
      method: "POST",
      headers: { "user-agent": "curl/8.0", "content-type": "application/json" },
    });
    expect(() => requireWorkerAuth(ordinaryRequest)).toThrow(WorkerAuthError);
  });
});
