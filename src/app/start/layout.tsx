import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nonprofit Payment Processing & Fundraising Platform | WGC",
  description: "Start accepting low-cost ACH and card donations. Onboard your church, nonprofit, or 501(c) organization onto WGC's white-label payment rails.",
  alternates: { canonical: "/start" },
  openGraph: {
    images: [{ url: "/og/default.png", width: 1200, height: 630 }], title: "Nonprofit Payment Processing & Fundraising Platform | WGC", description: "Start accepting low-cost ACH and card donations. Onboard your church, nonprofit, or 501(c) organization onto WGC's white-label payment rails.", url: "https://www.wgcpayments.com/start" },
};

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return children;
}
