import type { Metadata } from "next";
import { Globe2, Repeat, ShieldCheck, LayoutDashboard, Plane, CalendarDays } from "lucide-react";
import AudienceLandingPage, { type AudienceLandingContent } from "@/components/marketing/AudienceLandingPage";

export const metadata: Metadata = {
  title: "Donation Software for Nonprofits & Ministries",
  description: "Payment infrastructure for nonprofits, charities, and ministries — Christian and community nonprofits alike. Recurring giving, event ticketing, sponsorship-style support, and international donor payments.",
  openGraph: {
    images: [{ url: "/og/verticals.png", width: 1200, height: 630 }],
    title: "Donation Software for Nonprofits & Ministries",
    description: "Recurring giving, event ticketing, sponsorship-style support, and international donor payments for nonprofits and ministries.",
    url: "https://www.wgcpayments.com/for/christian-nonprofits",
  },
  alternates: { canonical: "/for/christian-nonprofits" },
};

const content: AudienceLandingContent = {
  eyebrow: "For Nonprofits & Ministries",
  headline: "Fund the mission,",
  headlineAccent: "not the overhead",
  intro: "Whether you're a Christian nonprofit, a missions organization, a community charity, or any other 501(c) organization, WGC Payments gives you low-cost, reliable donation processing so more of every gift reaches the cause.",
  whoWeServeTitle: "Built for nonprofits, ministries, and mission-driven organizations",
  whoWeServe: [],
  whoWeServeCategories: [
    {
      title: "Ministries & Faith-Based Organizations",
      items: [
        "Parachurch and affiliated ministries",
        "Worship, media, and creative arts ministries",
        "Faith-based nonprofits and outreach programs",
      ],
    },
    {
      title: "Charities & Community Organizations",
      items: [
        "Community and social-service charities",
        "Advocacy and civic organizations",
        "Arts, culture, and environmental nonprofits",
        "Health and human-services organizations",
      ],
    },
    {
      title: "Other Nonprofits",
      items: [
        "Private and community foundations",
        "Membership associations and sustaining-donor programs",
        "Nonprofit software platforms embedding giving for customers",
      ],
    },
  ],
  useCasesTitle: "Built for how nonprofits and ministries actually raise support",
  useCasesSubtitle: "Every organization raises support differently — from a monthly missionary supporter to a gala ticket sale.",
  useCases: [
    {
      title: "Monthly field-worker support",
      description: "Supporters commit to recurring monthly giving tied to a specific missionary or team, so field workers have predictable, sustained income.",
    },
    {
      title: "Sponsorship-style giving",
      description: "Run child-, family-, or project-sponsorship campaigns with dedicated giving pages that track sponsors against each sponsored recipient or project.",
    },
    {
      title: "General & designated donations",
      description: "Accept undesignated gifts to your general fund or route them to a specific program with dedicated giving links.",
    },
    {
      title: "Membership dues & sustaining gifts",
      description: "Collect recurring membership dues or sustaining-donor gifts on a schedule members set once and forget.",
    },
    {
      title: "Event & gala ticketing gifts",
      description: "Take ticket purchases and event-night giving through the same platform you already use for everyday donations.",
    },
    {
      title: "Emergency relief appeals",
      description: "Spin up a disaster-response giving page in minutes and start collecting gifts immediately when time matters most.",
    },
  ],
  featuresTitle: "Everything your organization needs to grow giving",
  featuresSubtitle: "A complete donation ecosystem designed for nonprofits and ministries, without the overhead of legacy processors.",
  features: [
    { icon: Globe2, title: "Give from anywhere", description: "Accept card and ACH donations from supporters and donors around the world through a secure giving page." },
    { icon: Plane, title: "Trip & team fundraising", description: "Give each missions trip or team its own giving link so supporters know exactly who and what they're funding." },
    { icon: CalendarDays, title: "Event & campaign giving links", description: "Spin up dedicated giving links for specific programs, campaigns, galas, or year-end appeals." },
    { icon: Repeat, title: "Recurring giving & dues", description: "Turn one-time donors into monthly partners or sustaining members with simple, flexible recurring giving." },
    { icon: ShieldCheck, title: "Secure onboarding", description: "PCI Level 1 compliant onboarding verifies your organization's data securely and swiftly." },
    { icon: LayoutDashboard, title: "Organization dashboard", description: "Track every gift, donor, and campaign in one dedicated, transparent portal." },
  ],
  faqTitle: "Nonprofit and ministry giving, answered",
  faqs: [
    {
      question: "Can supporters give to a specific missionary, program, or project?",
      answer: "Yes — create a dedicated giving link per missionary, team, program, or project so supporters and your finance team both know exactly where funds are going.",
    },
    {
      question: "Do you support recurring membership dues and monthly giving?",
      answer: "Yes — recurring giving works for monthly missionary support, membership dues, and sustaining-donor gifts on whatever schedule you set.",
    },
    {
      question: "Can we use this for event ticket sales or a sponsorship program?",
      answer: "Yes — event and ticketing gifts, and sponsorship-style giving pages, run through the same giving-link system as your everyday donations, so everything is reported in one place.",
    },
    {
      question: "Do you support international donors?",
      answer: "Yes, donors anywhere can give by card or bank transfer through your giving page; settlement into your organization's bank account follows standard processing.",
    },
    {
      question: "How fast can we launch a giving page for a new campaign or emergency appeal?",
      answer: "A new giving link can be live in minutes, so you can start collecting gifts as soon as a campaign or need is identified.",
    },
    {
      question: "Is our organization's data verified before we can start accepting gifts?",
      answer: "Yes — every organization goes through PCI Level 1 compliant onboarding that verifies your data before your giving pages go live.",
    },
  ],
  ctaHeadline: "Ready to expand your reach?",
  ctaSubheadline: "Join the nonprofits, ministries, and mission organizations using our infrastructure to fund their cause.",
};

export default function NonprofitsLandingPage() {
  return <AudienceLandingPage content={content} />;
}
