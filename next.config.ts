import type { NextConfig } from "next";

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
};

export default nextConfig;
