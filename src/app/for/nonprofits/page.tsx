import type { Metadata } from "next";
import { Repeat, ShieldCheck, LayoutDashboard, CalendarDays, Heart, FileText, BarChart3, Undo2, Users, Plug, Mail, MessageSquare } from "lucide-react";
import AudienceLandingPage, { type AudienceLandingContent } from "@/components/marketing/AudienceLandingPage";

export const metadata: Metadata = {
  title: "Nonprofit Payment Processing | $0 Cost to Your Org | WGC",
  description: "Nonprofit payment processing and donor management for 501(c) organizations: donations, recurring giving, campaigns, invoicing, reporting, and QuickBooks sync in one dashboard. $0 processing cost when donors cover the fee.",
  openGraph: {
    images: [{ url: "/og/verticals.png", width: 1200, height: 630 }],
    title: "Nonprofit Payment Processing | $0 Cost to Your Org | WGC",
    description: "Nonprofit payment processing and donor management for 501(c) organizations: donations, recurring giving, campaigns, invoicing, reporting, and QuickBooks sync in one dashboard. $0 processing cost when donors cover the fee.",
    url: "https://www.wgcpayments.com/for/nonprofits",
  },
  alternates: { canonical: "/for/nonprofits" },
};

const content: AudienceLandingContent = {
  eyebrow: "For Nonprofits & 501(c) Organizations",
  headline: "Nonprofit Payment Processing & Donor Management",
  headlineAccent: "for 501(c) Organizations",
  intro: "WGC is a payment processing and fundraising platform for nonprofits. Accept card and ACH donations, manage recurring gifts and donors, run campaigns, send invoices, and export reconciliation-ready reports from one dashboard. When donors cover the processing fee, your organization pays $0 in processing costs, plus a $10 monthly platform fee.",
  whoWeServeTitle: "Built for charities, community groups, and every other 501(c) organization",
  whoWeServe: [],
  whoWeServeCategories: [
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
      title: "Fundraising-Led Nonprofits",
      items: [
        "Peer-to-peer and team fundraisers",
        "Animal rescues and shelters",
        "Youth sports, PTAs, and booster clubs",
        "Capital and annual campaigns",
      ],
    },
    {
      title: "Other 501(c) Organizations",
      items: [
        "Private and community foundations",
        "Membership associations and sustaining-donor programs",
        "Faith-based nonprofits and ministries",
      ],
    },
  ],
  useCasesTitle: "Built for how nonprofits actually raise support",
  useCasesSubtitle: "Every organization raises money differently — from a monthly sustaining donor to a gala ticket sale.",
  useCases: [
    {
      title: "General & designated donations",
      description: "Accept undesignated gifts to your general fund or route them to a specific program with dedicated giving links.",
    },
    {
      title: "Monthly sustaining donors",
      description: "Turn one-time donors into predictable monthly support with recurring giving they set once and forget.",
    },
    {
      title: "Campaigns & year-end appeals",
      description: "Spin up a campaign giving page in minutes, email it to your supporter list, and track every gift by campaign.",
    },
    {
      title: "Event & gala ticketing",
      description: "Take ticket purchases and event-night giving through the same platform you use for everyday donations.",
    },
    {
      title: "Membership dues",
      description: "Collect recurring membership dues on a schedule members set once, with clear payment history for each member.",
    },
    {
      title: "Emergency relief appeals",
      description: "Stand up a dedicated giving page when time matters most and start collecting gifts immediately.",
    },
  ],
  featuresTitle: "Everything your organization needs — not just donation processing",
  featuresSubtitle: "A complete giving and operations platform for nonprofits, so your team isn't jumping between a processor, a spreadsheet, and separate reporting tools.",
  features: [
    { icon: Heart, title: "Donor management", description: "A full donor record — giving history, contact info, and notes — for every supporter and sponsor." },
    { icon: Repeat, title: "Recurring giving & dues", description: "Turn one-time donors into monthly partners or sustaining members with simple, flexible recurring giving." },
    { icon: Mail, title: "Email giving campaigns", description: "Send your giving link straight to a supporter list for an appeal or emergency response, with per-donor tracking." },
    { icon: MessageSquare, title: "Text campaigns", description: "Send your giving link to a supporter list by text message.", badge: "Coming Soon" },
    { icon: CalendarDays, title: "Event & campaign giving links", description: "Spin up dedicated giving links for specific programs, campaigns, galas, or year-end appeals." },
    { icon: FileText, title: "Invoicing", description: "Bill membership dues, event fees, or program costs and track payment status alongside your giving." },
    { icon: BarChart3, title: "Reporting & analytics", description: "Real-time dashboards on giving trends, supporter retention, and campaign performance." },
    { icon: Undo2, title: "Refunds & disputes", description: "Issue a refund or respond to a dispute directly from your dashboard." },
    { icon: ShieldCheck, title: "Donor statements", description: "Auto-generated, tax-ready annual giving statements for every donor — no manual compiling." },
    { icon: Users, title: "Team accounts & permissions", description: "Give staff and volunteers their own logins — Owner, Admin, Fundraiser, or Viewer access." },
    { icon: Plug, title: "QuickBooks integration", description: "Sync giving and transactions directly into QuickBooks, so your books stay current automatically." },
    { icon: LayoutDashboard, title: "Organization dashboard", description: "Track every gift, donor, and campaign in one dedicated, transparent portal." },
  ],
  teamSpotlightTitle: "Give your team the right access",
  teamSpotlightSubtitle: "Executive directors, finance staff, and volunteer fundraisers all need different levels of access. WGC gives each person their own login instead of one shared password everyone knows.",
  teamRoles: [
    { role: "Owner", description: "Full control — billing, team management, and every feature." },
    { role: "Admin", description: "Runs day-to-day operations: giving, donors, reports, and settings." },
    { role: "Fundraiser", description: "Manages campaigns and donor outreach without access to sensitive settings." },
    { role: "Viewer", description: "Read-only access for board members or auditors who just need visibility." },
  ],
  faqTitle: "Nonprofit payment processing, answered",
  faqs: [
    {
      question: "How much does nonprofit payment processing cost with WGC?",
      answer: "When a donor chooses to cover the processing fee, the cost to your organization is $0. Organizations that absorb the fee pay a maximum of 2.3% + 25¢ per card transaction and a flat 25¢ per ACH transaction. Every organization also pays a simple $10/month platform fee that includes the full dashboard.",
    },
    {
      question: "Is this just a donation processor?",
      answer: "No. Alongside card and ACH donations, WGC includes donor management, recurring giving, campaigns, invoicing, reporting, settlements, refunds, donor statements, team accounts with role-based permissions, and QuickBooks integration.",
    },
    {
      question: "Can we switch from Givebutter, Zeffy, Donorbox, or Stripe?",
      answer: "Yes. WGC helps migrate donor records, historical donation data, and organization information, including CSV imports. Saved card or bank details generally can't be transferred between processors, so recurring giving is reviewed during migration.",
    },
    {
      question: "Do you support recurring donations and membership dues?",
      answer: "Yes. Recurring giving works for monthly sustaining gifts and membership dues on whatever schedule you set.",
    },
    {
      question: "Does WGC support different logins for staff and volunteers?",
      answer: "Yes. Owner, Admin, Fundraiser, and Viewer roles let you give each person access scoped to what they actually need, instead of everyone sharing one login.",
    },
    {
      question: "How fast can we launch a giving page for a new campaign?",
      answer: "A new giving link can be live in minutes, and you can email it directly to your supporter list to start collecting gifts as soon as a campaign is ready.",
    },
  ],
  ctaHeadline: "Ready to give your team their time back?",
  ctaSubheadline: "Join the nonprofits using WGC to run giving, donors, and operations from one place.",
};

export default function NonprofitsLandingPage() {
  return <AudienceLandingPage content={content} />;
}
