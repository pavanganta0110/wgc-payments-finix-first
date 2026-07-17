import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Finix.js tokenization lib + inline scripts needed by Next.js hydration + Google reCAPTCHA
      "script-src 'self' 'unsafe-inline' https://js.finix.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://finix.live-payments-api.com https://finix.sandbox-payments-api.com",
      // Allow Google reCAPTCHA iframes
      "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
      // Prevent this page from being embedded anywhere
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    // The merchant dashboard shows live financial data (payments,
    // balances, donation totals) — Next's default client router cache
    // (30s for dynamic routes) can show a stale pre-transaction dashboard
    // after a sidebar navigation. Force every dynamic navigation to refetch.
    staleTimes: {
      dynamic: 0,
    },
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // /embed/* must be iframe-able... except Finix's own tokenization
        // SDK refuses to mount inside any iframe at all (confirmed by
        // testing), so this route is only ever opened as a top-level
        // popup window, never actually nested — this override exists so
        // that path stays available if a future Finix SDK update lifts
        // the iframe restriction. Per-org domain restriction (when an
        // admin opts in) is enforced at the application layer instead
        // (see src/lib/giving/embedDomainCheck.ts), since Next's
        // headers() here is static and can't vary per-org. Next merges
        // header entries by key in array order, so this later, more
        // specific match overrides X-Frame-Options/CSP for this path.
        source: "/embed/:path*",
        headers: [
          { key: "X-Frame-Options", value: "" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://js.finix.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: https:",
              "connect-src 'self' https://finix.live-payments-api.com https://finix.sandbox-payments-api.com",
              "frame-src 'self' https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
              "frame-ancestors *",
            ].join("; "),
          },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
