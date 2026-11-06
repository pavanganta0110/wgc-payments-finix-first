import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  wgcSubscription: { findUnique: vi.fn(), update: vi.fn() },
  smsAddonSubscription: { findUnique: vi.fn(), update: vi.fn() },
  church: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
const finix = vi.hoisted(() => ({ cancelSubscription: vi.fn() }));
vi.mock("@/lib/finix/client", () => ({ finixClient: finix }));
const audit = vi.hoisted(() => ({ logBillingAuditEvent: vi.fn() }));
vi.mock("@/lib/billing/billingAudit", () => audit);

import { describeStopBilling, getTerminatedOrganizationIds, stopBillingForTerminatedOrganization } from "../terminatedBilling";

const active = { id: "sub-1", status: "ACTIVE", finixSubscriptionId: "SB_1" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.wgcSubscription.findUnique.mockResolvedValue(active);
  prismaMock.smsAddonSubscription.findUnique.mockResolvedValue(null);
  finix.cancelSubscription.mockResolvedValue({});
  audit.logBillingAuditEvent.mockResolvedValue(undefined);
});

describe("stopBillingForTerminatedOrganization", () => {
  it("cancels the WGC subscription at Finix, marks it canceled, and records why", async () => {
    const r = await stopBillingForTerminatedOrganization("church-1");
    expect(r).toEqual({ wgcSubscription: "canceled", smsAddon: "none" });
    expect(finix.cancelSubscription).toHaveBeenCalledWith("SB_1");
    expect(prismaMock.wgcSubscription.update.mock.calls[0]![0]).toMatchObject({
      where: { id: "sub-1" },
      data: { status: "CANCELED", cancellationReason: "ORGANIZATION_TERMINATED" },
    });
    expect(audit.logBillingAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "church-1", action: "subscription.canceled_on_termination" }));
  });

  it("also cancels an active text-messaging add-on", async () => {
    prismaMock.smsAddonSubscription.findUnique.mockResolvedValue({ id: "sms-1", status: "ACTIVE", finixSubscriptionId: "SB_2" });
    const r = await stopBillingForTerminatedOrganization("church-1");
    expect(r.smsAddon).toBe("canceled");
    expect(finix.cancelSubscription).toHaveBeenCalledWith("SB_2");
    expect(prismaMock.smsAddonSubscription.update.mock.calls[0]![0]).toMatchObject({ where: { id: "sms-1" }, data: { status: "CANCELED" } });
  });

  it("does nothing, and calls Finix nowhere, when already canceled or nothing was ever created", async () => {
    prismaMock.wgcSubscription.findUnique.mockResolvedValue({ ...active, status: "CANCELED" });
    expect(await stopBillingForTerminatedOrganization("c")).toEqual({ wgcSubscription: "already_canceled", smsAddon: "none" });
    prismaMock.wgcSubscription.findUnique.mockResolvedValue({ ...active, finixSubscriptionId: null });
    expect((await stopBillingForTerminatedOrganization("c")).wgcSubscription).toBe("none");
    prismaMock.wgcSubscription.findUnique.mockResolvedValue(null);
    expect((await stopBillingForTerminatedOrganization("c")).wgcSubscription).toBe("none");
    expect(finix.cancelSubscription).not.toHaveBeenCalled();
  });

  it("never marks a subscription canceled unless Finix confirms, and reports the failure", async () => {
    finix.cancelSubscription.mockRejectedValue(new Error("Finix is down"));
    const r = await stopBillingForTerminatedOrganization("church-1");
    expect(r.wgcSubscription).toBe("failed");
    expect(prismaMock.wgcSubscription.update).not.toHaveBeenCalled();
    expect(audit.logBillingAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "subscription.cancel_on_termination_failed" }));
  });

  it("never throws, even if the database lookup fails", async () => {
    prismaMock.wgcSubscription.findUnique.mockRejectedValue(new Error("db down"));
    prismaMock.smsAddonSubscription.findUnique.mockRejectedValue(new Error("db down"));
    await expect(stopBillingForTerminatedOrganization("church-1")).resolves.toEqual({ wgcSubscription: "failed", smsAddon: "failed" });
  });
});

describe("describeStopBilling", () => {
  it("says what was canceled, and tells admin to cancel by hand when Finix failed", () => {
    expect(describeStopBilling({ wgcSubscription: "canceled", smsAddon: "none" })).toContain("subscription was canceled");
    expect(describeStopBilling({ wgcSubscription: "failed", smsAddon: "none" })).toContain("Cancel it manually");
    expect(describeStopBilling({ wgcSubscription: "none", smsAddon: "none" })).toBe("");
  });
});

describe("getTerminatedOrganizationIds", () => {
  it("returns the ids of terminated organizations only", async () => {
    prismaMock.church.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    expect(await getTerminatedOrganizationIds()).toEqual(["a", "b"]);
    expect(prismaMock.church.findMany.mock.calls[0]![0].where).toEqual({ status: "TERMINATED" });
  });
});
