"use client";

import Link from "next/link";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-wgc-off flex flex-col font-sans">
      <Header />
      
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-wgc-navy-950 text-wgc-gold-500 text-[11px] font-black tracking-[0.2em] uppercase mb-6 font-mono shadow-sm">
            Interactive Demos
          </div>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-wgc-navy-950 tracking-tight mb-6">
            Experience WGC Payments
          </h1>
          <p className="text-lg md:text-xl text-wgc-navy-500 font-medium max-w-2xl mx-auto tracking-tight">
            Explore the platform from both perspectives. See how simple giving is for donors, and how powerful the management is for organizations.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 mb-16">
          {/* Admin Demo Card */}
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-wgc-navy-50 flex flex-col h-full transform transition-all hover:-translate-y-1 hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-wgc-navy-950 text-white flex items-center justify-center text-2xl mb-8 shadow-lg">
              ⛪
            </div>
            <div className="text-[11px] font-black text-wgc-gold-500 uppercase tracking-widest mb-3 font-mono">
              For Organizations
            </div>
            <h2 className="text-3xl font-bold text-wgc-navy-950 mb-4 tracking-tight">
              Admin Dashboard
            </h2>
            <p className="text-wgc-navy-500 leading-relaxed font-medium mb-10 flex-1">
              See how WGC works for your team. Explore the dashboard, view transaction insights, manage recurring gifts, and track exactly where your funds land.
            </p>
            <Link 
              href="/demo/church-dashboard" 
              className="inline-flex items-center justify-center w-full px-8 py-5 bg-wgc-navy-950 text-white text-[13px] font-bold rounded-2xl uppercase tracking-widest transition-colors hover:bg-black shadow-md"
            >
              View Admin Demo
            </Link>
          </div>

          {/* Donor Demo Card */}
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.05)] border border-wgc-navy-50 flex flex-col h-full transform transition-all hover:-translate-y-1 hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.1)]">
            <div className="w-14 h-14 rounded-2xl bg-wgc-gold-500 text-wgc-navy-950 flex items-center justify-center text-2xl mb-8 shadow-lg">
              💛
            </div>
            <div className="text-[11px] font-black text-wgc-gold-500 uppercase tracking-widest mb-3 font-mono">
              For Donors
            </div>
            <h2 className="text-3xl font-bold text-wgc-navy-950 mb-4 tracking-tight">
              Giving Experience
            </h2>
            <p className="text-wgc-navy-500 leading-relaxed font-medium mb-10 flex-1">
              See what your donors will experience. Walk through our frictionless, mobile-optimized donation flow that helps you keep more of every gift.
            </p>
            <Link 
              href="/demo/donation" 
              className="inline-flex items-center justify-center w-full px-8 py-5 bg-white border-2 border-wgc-navy-100 text-wgc-navy-950 text-[13px] font-bold rounded-2xl uppercase tracking-widest transition-colors hover:border-wgc-navy-950 shadow-sm"
            >
              View Donor Experience
            </Link>
          </div>
        </div>

        {/* Secondary Actions */}
        <div className="bg-white rounded-3xl p-10 md:p-14 text-center border border-wgc-navy-50 shadow-sm">
          <h3 className="text-2xl font-bold text-wgc-navy-950 mb-4 tracking-tight">Ready to take the next step?</h3>
          <p className="text-wgc-navy-500 mb-10 max-w-xl mx-auto font-medium">Whether you want to discuss your specific needs or you're ready to set up your account, we're here to help.</p>
          
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-lg mx-auto">
            <a 
              href="https://calendly.com/collinsansom/1-on-1-wgc-first-look" 
              target="_blank" 
              rel="noopener noreferrer"
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-5 bg-white border border-wgc-navy-200 text-wgc-navy-950 text-[13px] font-bold rounded-2xl uppercase tracking-widest transition-colors hover:border-wgc-navy-950"
            >
              Book a Live Demo
            </a>
            <Link 
              href="/start" 
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-5 bg-wgc-gold-500 text-wgc-navy-950 text-[13px] font-bold rounded-2xl uppercase tracking-widest transition-all hover:bg-wgc-gold-400 shadow-md"
            >
              Get Started
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
