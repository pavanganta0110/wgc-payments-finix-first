import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

const prismaMock = vi.hoisted(() => ({ church: { findFirst: vi.fn() }, user: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/dashboardAudit", () => ({ logDashboardAction: vi.fn() }));

import { GET } from "../enter/route";
import { createPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

beforeAll(() => {
  process.env.AUTH_SESSION_SECRET = "x".repeat(40);
});

const owner = { id: "u1", email: "o@c.test", role: "owner", churchId: "c1", authVersion: 3, disabledAt: null };
const enter = (email: string | null = null, cookie?: string) => {
  const { token } = createPartnerEmbedLinkToken({ partnerId: "p1", reference: "loc_1", email, prefill: {} });
  return GET(new Request(`https://wgc.test/partner-embed/enter?link=${token}`, { headers: cookie ? { cookie } : {} }));
};
const sessionCookie = (over: Record<string, unknown> = {}) =>
  `${SESSION_COOKIE_NAME}=${createSessionToken({ userId: "u1", email: "o@c.test", role: "admin", churchId: "c1", authVersion: 3, embedded: true, ...over } as never)}`;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.church.findFirst.mockResolvedValue({ id: "c1" });
  prismaMock.user.findFirst.mockResolvedValue(owner);
});

describe("partner embed entry", () => {
  it("looks the organization up by partner and reference, and never signs anyone in from the link alone", async () => {
    const res = await enter();
    expect(prismaMock.church.findFirst.mock.calls[0][0].where).toEqual({ partnerId: "p1", partnerReference: "loc_1" });
    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({ churchId: "c1", role: "owner" });
    expect(res.headers.get("location")).toContain("/partner-embed/passcode?link=");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("uses the named person when they are on the team", async () => {
    await enter("a@c.test");
    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toMatchObject({ churchId: "c1", email: "a@c.test" });
  });

  it("skips the passcode when this person already has an embedded session", async () => {
    const res = await enter(null, sessionCookie());
    expect(res.headers.get("location")).toContain("/merchant/dashboard");
  });

  it("asks for the passcode when the session is someone else's, not embedded, or out of date", async () => {
    for (const over of [{ userId: "u2" }, { embedded: false }, { authVersion: 1 }, { churchId: "c2" }]) {
      expect((await enter(null, sessionCookie(over))).headers.get("location")).toContain("/partner-embed/passcode");
    }
  });

  it("sends disabled users, unknown people and unknown organizations back with no session", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ ...owner, disabledAt: new Date() });
    expect((await enter()).headers.get("location")).toContain("problem=1");
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect((await enter()).headers.get("location")).toContain("problem=1");
    prismaMock.church.findFirst.mockResolvedValue(null);
    const res = await enter();
    expect(res.headers.get("location")).toContain("problem=1");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("ignores a forged link", async () => {
    const res = await GET(new Request("https://wgc.test/partner-embed/enter?link=junk"));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(prismaMock.church.findFirst).not.toHaveBeenCalled();
  });
});
