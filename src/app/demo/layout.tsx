import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Demo: Church & Nonprofit Giving Page | WGC",
  description: "Try the WGC giving experience your donors see: cards, ACH, Apple Pay and Google Pay, with an optional donor-covered fee.",
  alternates: { canonical: "/demo" },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
