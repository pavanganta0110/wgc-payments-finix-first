import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Static source-structure checks only — these read file TEXT and assert
 * literal substrings. They do NOT touch a database, create tenants, or
 * prove anything about cross-tenant data isolation (renamed from
 * "merchantDashboardIsolation.test.ts", which claimed exactly that in its
 * filename despite doing none of it — see
 * e2e/multiTenantDashboardIsolation.spec.ts for the real, DB-backed
 * isolation test, and src/lib/reporting/__tests__/donorReportTenantIsolation.test.ts
 * and the ~25 other query-scoping tests across donors/payments/invoices/
 * subscriptions/exports for isolation coverage at the data layer).
 */

const DASHBOARD_LAYOUT = readFileSync(join(__dirname, "../(dashboard)/layout.tsx"), "utf-8");
const LOGIN_PAGE = readFileSync(join(__dirname, "../login/page.tsx"), "utf-8");
const AUTH_OPTIONS = readFileSync(join(__dirname, "../../../components/auth/AuthOptions.tsx"), "utf-8");
const SIDEBAR = readFileSync(join(__dirname, "../../../components/merchant/Sidebar.tsx"), "utf-8");

describe("Merchant dashboard layout — no public marketing chrome", () => {
  it("does not import the public site Header or Footer", () => {
    expect(DASHBOARD_LAYOUT).not.toContain('from "@/components/layout/Header"');
    expect(DASHBOARD_LAYOUT).not.toContain('from "@/components/layout/Footer"');
  });

  it("still enforces requireMerchantSession() and redirects to /merchant/login on auth failure", () => {
    expect(DASHBOARD_LAYOUT).toContain("requireMerchantSession()");
    expect(DASHBOARD_LAYOUT).toContain('redirect("/merchant/login")');
  });

  it("displays the organization name", () => {
    expect(DASHBOARD_LAYOUT).toContain("church.name");
  });
});

describe("Merchant login page — session-aware redirect", () => {
  it("redirects an already-authenticated merchant to their dashboard server-side", () => {
    expect(LOGIN_PAGE).toContain("requireMerchantSession(true)");
    expect(LOGIN_PAGE).toContain("resolveSafeMerchantRedirect(");
  });

  it("uses router.replace (not push) after login so back doesn't return to the login page", () => {
    // Login now renders the shared AuthOptions component (merchant and
    // other login surfaces both use it) rather than doing this itself —
    // the replace-not-push behavior lives there.
    expect(AUTH_OPTIONS).toContain("router.replace(finalDest)");
    expect(AUTH_OPTIONS).not.toContain('router.push(finalDest)');
  });
});

describe("Merchant sidebar — section coverage", () => {
  it("includes a Team link", () => {
    expect(SIDEBAR).toContain('{ name: "Team", href: "/merchant/settings/team"');
  });
});
