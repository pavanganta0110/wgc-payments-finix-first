import { Mail, Phone, LifeBuoy } from "lucide-react";

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-slate-900">Support</h2>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
            <LifeBuoy className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Contact WGC Payments Support</h3>
            <p className="text-xs text-slate-500">We typically respond within one business day.</p>
          </div>
        </div>

        <div className="space-y-3">
          <a
            href="mailto:support@wgcpayments.com"
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"
          >
            <Mail className="w-4 h-4 text-slate-400" />
            support@wgcpayments.com
          </a>
          <a
            href="/contact"
            className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"
          >
            <Phone className="w-4 h-4 text-slate-400" />
            View full contact options
          </a>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 max-w-2xl">
        <h3 className="text-sm font-bold text-slate-900 mb-2">Before reaching out</h3>
        <p className="text-sm text-slate-500">
          For questions about a specific payment, refund, or dispute, include the ID shown on that record's detail
          panel — you can copy it by clicking the ID badge next to any transaction. It helps our team find your
          record instantly.
        </p>
      </div>
    </div>
  );
}
