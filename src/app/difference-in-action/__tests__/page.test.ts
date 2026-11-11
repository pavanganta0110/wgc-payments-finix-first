import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const mockLoad = vi.fn();
vi.mock("@/lib/givingLinks/loadPublicGivingPageData", () => ({ loadPublicGivingPageData: (...a: unknown[]) => mockLoad(...a) }));
vi.mock("@/components/giving/GivingLinkForm", () => ({
  default: (p: { slug: string; churchName: string }) => createElement("div", null, `FORM:${p.slug}:${p.churchName}`),
}));
vi.mock("next/image", () => ({
  default: (p: { alt: string }) => createElement("img", { alt: p.alt }),
}));

const okData = {
  ok: true,
  light: { borderColor: "#ddd", headerBackground: "#fff" },
  church: { name: "Difference in Action, Inc.", finixMerchantId: "MU1" },
  link: { merchandiseEnabled: false, amountType: "VARIABLE" },
  branding: {},
};

async function render() {
  const { default: Page } = await import("../page");
  return renderToStaticMarkup(await Page());
}

describe("/difference-in-action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("renders the real giving form (not the embed script) for the giving link slug", async () => {
    mockLoad.mockResolvedValue(okData);
    const html = await render();
    expect(html).toContain("FORM:OTBGXJkW4Jvh:Difference in Action, Inc.");
    expect(html).not.toContain("wgc-giving.js");
    expect(html).toContain("402-363-8963");
  });

  it("falls back to the hosted giving page when the data can't load", async () => {
    mockLoad.mockRejectedValue(new Error("db down"));
    const html = await render();
    expect(html).not.toContain("FORM:");
    expect(html).toContain('href="/g/OTBGXJkW4Jvh"');
  });

  it("falls back when the link is not ok", async () => {
    mockLoad.mockResolvedValue({ ok: false, notFound: true });
    expect(await render()).toContain('href="/g/OTBGXJkW4Jvh"');
  });
});
