import Image from "next/image";
import GivingLinkForm from "@/components/giving/GivingLinkForm";
import { loadPublicGivingPageData } from "@/lib/givingLinks/loadPublicGivingPageData";
import type { Metadata } from "next";

const GIVING_SLUG = "OTBGXJkW4Jvh";
const GIVING_URL = `/g/${GIVING_SLUG}`;
const PHONE_DISPLAY = "402-363-8963";
const PHONE_TEL = "+14023638963";
const IMG = "/images/difference-in-action";

// The form reads live giving-link data, so this page must render per request.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Difference in Action | Support Difference Makers",
  description:
    "Difference in Action implements community impact programs focused on agricultural education, food security, environmental conservation and entrepreneurship. Give securely online.",
  openGraph: {
    title: "Difference in Action",
    description: "Community impact programs for agricultural education, food security and conservation.",
    images: [`${IMG}/greenhouse-tour-v2.jpg`],
  },
};

const GALLERY = [
  { src: "students-garden-v2.jpg", alt: "Two Difference Makers students outside in front of a native milkweed garden" },
  { src: "planning-v2.jpg", alt: "Students planning a Difference Makers project together at a table" },
  { src: "zinnias-v2.jpg", alt: "Students arranging freshly cut zinnias at a community event" },
  { src: "kenya-greenhouse-v2.jpg", alt: "A child holding a large armful of freshly harvested greens in a greenhouse" },
];

function GiveButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="#give"
      className={`inline-flex items-center justify-center rounded-full bg-[#1B7F2A] px-8 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-[#15691f] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#1B7F2A]/30 ${className}`}
    >
      Give now
    </a>
  );
}

async function loadGivingData() {
  try {
    const data = await loadPublicGivingPageData(GIVING_SLUG);
    // Merchandise checkout isn't used here; anything unusual falls back to the hosted page.
    if (!data.ok || data.link.merchandiseEnabled || !data.church.finixMerchantId) return null;
    return data;
  } catch (err) {
    console.error("[difference-in-action] could not load giving form:", err);
    return null;
  }
}

export default async function DifferenceInActionPage() {
  const data = await loadGivingData();
  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Image src={`${IMG}/logo.png`} alt="Difference Makers: Difference in Action logo" width={56} height={52} className="h-12 w-auto" priority />
            <span className="text-lg font-bold text-[#1F6FB5]">Difference in Action</span>
          </div>
          <GiveButton className="!px-5 !py-2 !text-sm" />
        </div>
      </header>

      <main>
        <section className="bg-gradient-to-b from-[#EEF6EC] to-white">
          <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 md:py-16">
            <div>
              <h1 className="text-4xl font-extrabold leading-tight text-[#1F6FB5] sm:text-5xl">
                Difference in Action
                <span className="block text-[#1B7F2A]">Mission and Purpose</span>
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-slate-700">
                Implementing community impact programs focused on lifelong agricultural education, food security, environmental conservation, entrepreneurship, and global/local humanitarian issues, that inspire better understanding and tangible outcomes that make a positive impact for the land, water, and all creatures great and small.
              </p>
            </div>
            <div className="overflow-hidden rounded-2xl shadow-lg">
              <Image
                src={`${IMG}/greenhouse-tour-v2.jpg`}
                alt="Difference Makers students learning in a greenhouse full of tomato plants"
                width={1400}
                height={1022}
                className="h-auto w-full"
                priority
              />
            </div>
          </div>
        </section>

        <section id="give" className="mx-auto max-w-2xl scroll-mt-20 px-4 py-12 sm:px-6">
          <h2 className="text-center text-2xl font-bold text-[#1F6FB5]">Give to Difference in Action</h2>
          {data ? (
            <div
              className="mt-6 rounded-2xl border bg-white p-6 shadow-sm"
              style={{ borderColor: data.light.borderColor, backgroundColor: data.light.headerBackground }}
            >
              <GivingLinkForm
                slug={GIVING_SLUG}
                finixMerchantId={data.church.finixMerchantId!}
                churchName={data.church.name}
                light={data.light}
                amountType={data.link.amountType as "FIXED" | "VARIABLE" | "FIXED_QUANTITY"}
                fixedAmountCents={data.link.fixedAmountCents}
                minAmountCents={data.link.minAmountCents}
                maxAmountCents={data.link.maxAmountCents}
                suggestedAmountsCents={data.suggestedAmountsCents}
                allowCustomAmount={data.link.allowCustomAmount}
                quantityItemLabel={data.link.quantityItemLabel}
                recurringEnabled={data.link.recurringEnabled}
                allowedFrequencies={data.allowedFrequencies}
                defaultDonationType={data.link.defaultDonationType}
                defaultRecurringAmountCents={data.link.defaultRecurringAmountCents}
                allowedPaymentMethods={data.allowedPaymentMethods}
                feeCoverEnabled={data.link.feeCoverEnabled}
                feeCoverDefaultOn={data.link.feeCoverDefaultOn}
                donorFieldSettings={data.donorFieldSettings}
                collectMailingAddress={data.link.collectMailingAddress}
                pricing={data.pricing}
                thankYouMessage={data.branding.thankYouMessage}
                thankYouVideoUrl={data.branding.thankYouVideoUrl}
                googlePayGatewayMerchantId={data.googlePayGatewayMerchantId}
                googlePayMerchantId={data.googlePayMerchantId}
                googlePayEnvironment={data.googlePayEnvironment}
                serverAvailability={data.serverAvailability}
                fundSelectionEnabled={data.fundSelectionEnabled}
                assignedFunds={data.assignedFunds}
              />
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-slate-700">Give securely through our giving page.</p>
              <a href={GIVING_URL} className="mt-4 inline-flex rounded-full bg-[#1B7F2A] px-8 py-3 font-bold text-white hover:bg-[#15691f]">
                Give now
              </a>
            </div>
          )}
          {data && (
            <p className="mt-4 text-center text-sm text-slate-500">
              Trouble with the form?{" "}
              <a href={GIVING_URL} className="font-medium text-[#1F6FB5] underline">
                Give on our secure giving page
              </a>
              .
            </p>
          )}
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
          <h2 className="text-2xl font-bold text-[#1F6FB5]">Our programs in action</h2>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {GALLERY.map((p) => (
              <div key={p.src} className="relative aspect-[3/4] overflow-hidden rounded-xl bg-slate-100">
                <Image src={`${IMG}/${p.src}`} alt={p.alt} fill sizes="(min-width: 768px) 25vw, 50vw" className="object-cover" />
              </div>
            ))}
          </div>

          <div className="mt-10 grid items-center gap-6 rounded-2xl bg-[#EEF6EC] p-5 sm:p-8 md:grid-cols-2">
            <div className="relative aspect-[4/5] overflow-hidden rounded-xl">
              <Image src={`${IMG}/banner-v2.jpg`} alt="A volunteer standing beside the Difference Makers program banner" fill sizes="(min-width: 768px) 40vw, 100vw" className="object-cover" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#1B7F2A]">Growing food, growing futures</h2>
              <p className="mt-3 leading-relaxed text-slate-700">
                From local classrooms, main streets, gardens, farms, and ranches to communities around the world, we help people grow, understand and share good food and educational opportunities that bring everyone who eats to the table. There is a reason culture is in the word agriCULTURE. Food is culture. Food is the center of life. Food brings people together. Food is the joy of life. Help us share that joy and hope with others.
              </p>
              <div className="mt-6">
                <GiveButton />
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-50">
          <div className="mx-auto max-w-5xl px-4 py-12 text-center sm:px-6">
            <h2 className="text-2xl font-bold text-[#1F6FB5]">Contact us</h2>
            <p className="mt-4 text-lg font-semibold text-slate-900">Kerry Hoffschneider</p>
            <p className="text-slate-600">Co-founder of Difference in Action</p>
            <p className="mt-3">
              <a href={`tel:${PHONE_TEL}`} className="text-xl font-bold text-[#1B7F2A] hover:underline">
                {PHONE_DISPLAY}
              </a>
            </p>
            <p className="mt-1 text-sm text-slate-500">Calls or texts are welcome.</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
        <p>Gifts to Difference in Action, Inc. are processed securely through WGC Payments.</p>
        <p className="mt-1">
          <a href="https://www.wgcpayments.com" className="font-medium text-[#1F6FB5] hover:underline">
            wgcpayments.com
          </a>
        </p>
      </footer>
    </div>
  );
}
