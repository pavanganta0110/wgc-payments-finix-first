import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({ user: { findFirst: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
const scope = vi.hoisted(() => ({ resolveViewScope: vi.fn() }));
vi.mock("../viewScope", () => scope);
const session = vi.hoisted(() => ({ requireMerchantSession: vi.fn() }));
vi.mock("../requireMerchantSession", () => session);
const nav = vi.hoisted(() => ({ redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }) }));
vi.mock("next/navigation", () => nav);

import { resolveViewAsAuth, redirectIfViewAsLacksSettlementAccess } from "../viewAsAccess";
import { hasPermission } from "../permissions";
import { visibleNavItems } from "@/components/merchant/Sidebar";

const owner = { userId: "u1", email: "o@c.test", churchId: "c1", rawRole: "owner", role: "owner", isWgcAdmin: false, permissionsJson: null, authVersion: 1, authTime: 1 } as never;

beforeEach(() => vi.clearAllMocks());

describe("view as: what the viewer sees follows the teammate", () => {
  it("is the viewer's own context when nobody is being viewed as", async () => {
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "organization" }, isViewingAsOther: false });
    expect(await resolveViewAsAuth(owner)).toBe(owner);
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("takes the teammate's role and overrides, looked up inside the same organization", async () => {
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "user", userId: "u2" }, isViewingAsOther: true });
    prismaMock.user.findFirst.mockResolvedValue({ role: "fundraiser", permissionsJson: null });
    const viewAuth = await resolveViewAsAuth(owner);
    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({ id: "u2", churchId: "c1" });
    expect(viewAuth.role).toBe("fundraiser");
    expect(hasPermission(viewAuth, "canViewSettlements")).toBe(false);
  });

  it("hides Settlements and Deposits from the menu for a fundraiser, and keeps them for an admin", async () => {
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "user", userId: "u2" }, isViewingAsOther: true });
    prismaMock.user.findFirst.mockResolvedValue({ role: "fundraiser", permissionsJson: null });
    const asFundraiser = await resolveViewAsAuth(owner);
    const names = visibleNavItems(asFundraiser.role ?? undefined).map((i) => i.name);
    expect(names).not.toContain("Settlements");
    expect(names).not.toContain("Deposits");
    prismaMock.user.findFirst.mockResolvedValue({ role: "admin", permissionsJson: null });
    const asAdmin = await resolveViewAsAuth(owner);
    expect(visibleNavItems(asAdmin.role ?? undefined).map((i) => i.name)).toContain("Deposits");
  });

  it("falls back to the viewer's context when the teammate is not found", async () => {
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "user", userId: "gone" }, isViewingAsOther: true });
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await resolveViewAsAuth(owner)).toBe(owner);
  });
});

describe("Deposits and Settlements pages while viewing as someone", () => {
  it("send the viewer to the dashboard when the teammate could not open them", async () => {
    session.requireMerchantSession.mockResolvedValue(owner);
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "user", userId: "u2" }, isViewingAsOther: true });
    prismaMock.user.findFirst.mockResolvedValue({ role: "fundraiser", permissionsJson: null });
    await expect(redirectIfViewAsLacksSettlementAccess()).rejects.toThrow("NEXT_REDIRECT");
    expect(nav.redirect).toHaveBeenCalledWith("/merchant/dashboard");
  });

  it("let the viewer through for a teammate who could, and when not viewing as anyone", async () => {
    session.requireMerchantSession.mockResolvedValue(owner);
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "user", userId: "u2" }, isViewingAsOther: true });
    prismaMock.user.findFirst.mockResolvedValue({ role: "admin", permissionsJson: null });
    await expect(redirectIfViewAsLacksSettlementAccess()).resolves.toBeUndefined();
    scope.resolveViewScope.mockResolvedValue({ effective: { kind: "organization" }, isViewingAsOther: false });
    await expect(redirectIfViewAsLacksSettlementAccess()).resolves.toBeUndefined();
    expect(nav.redirect).not.toHaveBeenCalled();
  });
});
