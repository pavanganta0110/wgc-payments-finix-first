import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "90 Days Free Church & Nonprofit Giving Platform | WGC",
  description: "Start WGC free for 90 days: online giving, recurring donations, donor management and reporting for churches and nonprofits.",
  alternates: { canonical: "/90-days-free" },
};

export default function NinetyDaysFreeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
