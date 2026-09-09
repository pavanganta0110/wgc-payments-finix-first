import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const FAKE_FINIX_PORT = 4310;
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // spec files share one Postgres database; keep runs serialized to avoid cross-test interference
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: "./e2e/globalSetup.ts",
  globalTeardown: "./e2e/globalTeardown.ts",

  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: [
    {
      command: `node e2e/fixtures/fakeFinixServer.mjs`,
      port: FAKE_FINIX_PORT,
      reuseExistingServer: !process.env.CI,
      env: { FAKE_FINIX_PORT: String(FAKE_FINIX_PORT) },
      timeout: 15_000,
    },
    {
      command: "npm run dev",
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Route every finixClient call at the local fake Finix server
        // above instead of the real (credential-redacted) Finix sandbox.
        FINIX_BASE_URL: `http://127.0.0.1:${FAKE_FINIX_PORT}`,
        FINIX_USERNAME: "e2e-fake-username",
        FINIX_PASSWORD: "e2e-fake-password",
        // Not present in .env.local today — required by
        // src/lib/billing/wgcBillingConfig.ts's fail-closed check before
        // any WGC platform-subscription Finix call.
        FINIX_WGC_BILLING_MERCHANT_ID: "MU_e2e_wgc_billing_merchant",
        // Not present in .env.local today either — required by
        // resolveWgcTransferFeeStrategy() (src/lib/giving/serverFeeStrategy.ts)
        // before any donation/invoice-payment fee calculation. Without these
        // any E2E flow that completes a real POST to a payment route (not
        // just ones that mock the response client-side) throws a
        // "Server configuration error" before it ever reaches the actual
        // Finix call it's meant to exercise — opaque IDs only, meaningless
        // to the fake Finix server, which doesn't validate their format.
        WGC_DONOR_COVERED_ZERO_FEE_PROFILE_ID: "FP_e2e_zero_fee_profile",
        WGC_ORGANIZATION_PAID_FEE_PROFILE_ID: "FP_e2e_org_paid_profile",
        // Wallet-boundary Playwright coverage options
        NEXT_PUBLIC_ENABLE_TEST_WALLET_ADAPTER: "true",
        FINIX_APPLICATION_OWNER_ID: "AP_e2e_test_dummy_owner",
      },
    },
  ],
});
