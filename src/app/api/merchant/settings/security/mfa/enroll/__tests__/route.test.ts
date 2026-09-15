import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/lib/auth/requireMerchantSession", () => ({
  requireMerchantSession: () => mockAuth(),
}));

const mockPrisma = {
  user: { update: vi.fn().mockResolvedValue({}) },
};
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

vi.mock("@/lib/sms/sendText", () => ({ isSmsConfigured: () => true }));

const mockSend = vi.fn();
vi.mock("@/lib/sms/smsProvider", () => ({ getSmsProvider: () => ({ send: mockSend }) }));

const mockRecordGranted = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth/smsConsent", () => ({ recordSmsConsentGranted: (...args: unknown[]) => mockRecordGranted(...args) }));

async function loadModule() {
  vi.resetModules();
  return import("@/app/api/merchant/settings/security/mfa/enroll/route");
}

function req(body: Record<string, unknown>) {
  return new Request("http://x/api/merchant/settings/security/mfa/enroll", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ userId: "user-1", churchId: "church-a", authTime: Math.floor(Date.now() / 1000) });
  mockSend.mockResolvedValue({ success: true });
});

describe("POST /api/merchant/settings/security/mfa/enroll — SMS consent gate", () => {
  it("rejects enrollment when the consent checkbox was not checked, even with a valid phone", async () => {
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "(555) 019-2837", smsConsent: false }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/agree to receive SMS/i);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRecordGranted).not.toHaveBeenCalled();
  });

  it("rejects enrollment when smsConsent is omitted entirely — a phone number alone is never consent", async () => {
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "(555) 019-2837" }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRecordGranted).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean-true consent value (defense against a truthy-but-wrong payload)", async () => {
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "(555) 019-2837", smsConsent: "true" }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("proceeds and records a GRANTED consent event when the phone is valid and consent is explicitly true", async () => {
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "(555) 019-2837", smsConsent: true }));
    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockRecordGranted).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", churchId: "church-a", source: "settings_security_mfa_enroll" })
    );
  });

  it("does not record consent if the SMS send itself fails", async () => {
    mockSend.mockResolvedValue({ success: false, error: "Twilio rejected the number" });
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "(555) 019-2837", smsConsent: true }));
    expect(res.status).toBe(502);
    expect(mockRecordGranted).not.toHaveBeenCalled();
  });

  it("rejects an invalid phone number before ever checking consent or sending", async () => {
    const { POST } = await loadModule();
    const res = await POST(req({ phone: "not-a-phone", smsConsent: true }));
    expect(res.status).toBe(400);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
