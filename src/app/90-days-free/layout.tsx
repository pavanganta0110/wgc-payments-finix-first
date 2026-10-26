import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Donation Platform for Nonprofits: 90 Days Free | WGC",
  description: "Start accepting donations and recurring gifts today. Your WGC Platform subscription is free for your first 90 days.",
  alternates: { canonical: "/90-days-free" },
};

export default function NinetyDaysFreeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
