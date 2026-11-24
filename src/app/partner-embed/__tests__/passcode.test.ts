import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const prismaMock = vi.hoisted(() => ({
  church: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  partnerEmbedPasscode: { findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/dashboardAudit", () => ({ logDashboardAction: vi.fn() }));
const sendWgcEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendWgcEmail }));

import { POST as send } from "../passcode/send/route";
import { POST as verify } from "../passcode/verify/route";
import { createPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { hashMfaCode } from "@/lib/auth/mfaCode";
import { verifySessionToken } from "@/lib/auth/session";

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = "x".repeat(40);
});

const user = { id: "u1", email: "fran@c.test", role: "fundraiser", churchId: "c1", authVersion: 2, disabledAt: null };
const form = (fields: Record<string, string>) => {
  const body = new URLSearchParams(fields);
  return new Request("https://wgc.test/x", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } });
};
const link = () => createPartnerEmbedLinkToken({ partnerId: "p1", reference: "loc_1", email: "fran@c.test", prefill: {} }).token;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.church.findFirst.mockResolvedValue({ id: "c1" });
  prismaMock.user.findFirst.mockResolvedValue(user);
  prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(null);
  prismaMock.partnerEmbedPasscode.count.mockResolvedValue(0);
  prismaMock.partnerEmbedPasscode.updateMany.mockResolvedValue({ count: 1 });
  sendWgcEmail.mockResolvedValue({ success: true });
});

describe("sending the passcode", () => {
  it("emails a 6-digit code to the person's own address and stores only its hash", async () => {
    const res = await send(form({ link: link() }));
    expect(res.headers.get("location")).toContain("sent=1");
    expect(sendWgcEmail.mock.calls[0][0].to).toBe("fran@c.test");
    const code = /strong[^>]*>(\d{6})</.exec(sendWgcEmail.mock.calls[0][0].bodyHtml)![1];
    const stored = prismaMock.partnerEmbedPasscode.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(hashMfaCode(code));
    expect(JSON.stringify(stored)).not.toContain(code);
  });

  it("does not email anyone who is not on the team", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const res = await send(form({ link: link() }));
    expect(res.headers.get("location")).toContain("problem=1");
    expect(sendWgcEmail).not.toHaveBeenCalled();
  });

  it("enforces the resend cooldown and the hourly cap", async () => {
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue({ createdAt: new Date() });
    expect((await send(form({ link: link() }))).headers.get("location")).toContain("error=cooldown");
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(null);
    prismaMock.partnerEmbedPasscode.count.mockResolvedValue(5);
    expect((await send(form({ link: link() }))).headers.get("location")).toContain("error=limited");
    expect(sendWgcEmail).not.toHaveBeenCalled();
  });

  it("ignores a forged link", async () => {
    await send(form({ link: "junk" }));
    expect(prismaMock.church.findFirst).not.toHaveBeenCalled();
    expect(sendWgcEmail).not.toHaveBeenCalled();
  });
});

describe("verifying the passcode", () => {
  const row = { id: "r1", codeHash: hashMfaCode("123456") };

  it("starts the embedded session on the right code", async () => {
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(row);
    const res = await verify(form({ link: link(), code: "123 456" }));
    expect(res.headers.get("location")).toContain("/merchant/dashboard");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("SameSite=None");
    expect(verifySessionToken(/=([^;]+)/.exec(cookie)![1])).toMatchObject({ userId: "u1", role: "fundraiser", embedded: true });
  });

  it("refuses a wrong code with no session, and counts the guess", async () => {
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(row);
    const res = await verify(form({ link: link(), code: "000000" }));
    expect(res.headers.get("location")).toContain("error=invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(prismaMock.partnerEmbedPasscode.updateMany.mock.calls[0][0].data).toEqual({ attempts: { increment: 1 } });
  });

  it("refuses when the attempts are used up, there is no live code, or the code is not 6 digits", async () => {
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(row);
    prismaMock.partnerEmbedPasscode.updateMany.mockResolvedValue({ count: 0 });
    expect((await verify(form({ link: link(), code: "123456" }))).headers.get("set-cookie")).toBeNull();
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(null);
    expect((await verify(form({ link: link(), code: "123456" }))).headers.get("set-cookie")).toBeNull();
    expect((await verify(form({ link: link(), code: "12" }))).headers.get("set-cookie")).toBeNull();
  });

  it("does not accept a code that was already used", async () => {
    prismaMock.partnerEmbedPasscode.findFirst.mockResolvedValue(row);
    prismaMock.partnerEmbedPasscode.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    expect((await verify(form({ link: link(), code: "123456" }))).headers.get("set-cookie")).toBeNull();
  });
});
