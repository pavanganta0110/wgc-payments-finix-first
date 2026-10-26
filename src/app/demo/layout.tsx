import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Nonprofit Donation Platform Demo | WGC",
  description: "See the WGC nonprofit donation platform in action: a white-label giving experience that embeds into your software with full brand integrity.",
  alternates: { canonical: "/demo" },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
