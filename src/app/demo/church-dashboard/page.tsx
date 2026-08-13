"use client";

import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function DemoDashboardPage() {
  return (
    <div className="min-h-screen bg-wgc-off flex flex-col font-sans">
      <Header />
      
      <main className="flex-1 w-full pt-10 pb-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Top Note */}
          <div className="mb-8 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white text-wgc-gold-500 text-[10px] font-bold tracking-widest uppercase mb-4 font-mono border border-wgc-gold-500/20 shadow-sm">
              Interactive Walkthrough
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-wgc-navy-900 tracking-tight">Explore the Admin Dashboard</h1>
            <p className="mt-4 text-lg text-slate-500 font-medium tracking-tight max-w-2xl mx-auto">
              Step through our powerful merchant dashboard. View transaction insights, manage recurring gifts, and track where your funds land.
            </p>
          </div>

          {/* Interactive Walkthrough Iframe */}
          <div className="w-full bg-white rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.1)] border border-slate-200 overflow-hidden ring-1 ring-slate-100 p-2 sm:p-4">
            <iframe 
              src="/walkthrough" 
              title="WGC Merchant Dashboard Walkthrough" 
              loading="lazy"
              className="w-full h-[760px] md:h-[900px] border-0 rounded-2xl bg-transparent block"
            ></iframe>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
