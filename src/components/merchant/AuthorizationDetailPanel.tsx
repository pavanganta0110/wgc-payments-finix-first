import { prisma } from "@/lib/prisma";
import { formatCents } from "@/lib/format";
import CopyableIdBadge from "@/components/merchant/CopyableIdBadge";
import ClosePanelButton from "@/components/merchant/ClosePanelButton";
import StateBadge from "@/components/merchant/StateBadge";
import { formatPersonName } from "@/lib/formatPersonName";

function formatDateTime(date: Date | null | undefined) {
  if (!date) return "—";
  return new Date(date).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function titleCase(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .replace(/_/g, " ")
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between text-sm py-1 gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className="font-semibold text-slate-700 text-right break-all">{value}</span>
    </div>
  );
}

function resolveDisplayStatus(state: string | null | undefined, isVoid: boolean | null | undefined) {
  if (isVoid) return "VOIDED";
  return state ?? "UNKNOWN";
}

export default async function AuthorizationDetailPanel({
  authorizationId,
  churchId,
}: {
  authorizationId: string;
  churchId: string;
}) {
  const auth = await prisma.finixAuthorization.findFirst({
    where: { finixAuthorizationId: authorizationId, churchId },
  });

  if (!auth) {
    return (
      <div className="w-full lg:w-[420px] shrink-0 bg-white border border-slate-100 rounded-2xl shadow-sm p-6">
        <p className="text-sm text-slate-500">Authorization not found.</p>
      </div>
    );
  }

  const instrument = auth.finixPaymentInstrumentId
    ? await prisma.finixPaymentInstrumentSnapshot.findUnique({
        where: { finixPaymentInstrumentId: auth.finixPaymentInstrumentId },
      })
    : null;

  const donor = instrument?.donorId
    ? await prisma.donor.findUnique({ where: { id: instrument.donorId } })
    : null;

  const displayStatus = resolveDisplayStatus(auth.state, auth.isVoid);

  return (
    <div className="w-full lg:w-[420px] shrink-0 bg-white border border-slate-100 rounded-2xl shadow-sm h-fit lg:sticky lg:top-6">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-900">Authorization</h3>
        <ClosePanelButton />
      </div>

      {/* Amount + status */}
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-2xl font-bold text-slate-900">{formatCents(auth.amountCents ?? 0)}</p>
        {auth.amountRequestedCents != null && auth.amountRequestedCents !== auth.amountCents && (
          <p className="text-xs text-slate-400 mt-0.5">Requested {formatCents(auth.amountRequestedCents)}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <StateBadge state={displayStatus} />
          {auth.isVoid && auth.state && auth.state !== "VOIDED" && (
            <span className="text-xs text-slate-400">(original: {auth.state})</span>
          )}
        </div>
        {auth.failureCode && (
          <p className="text-xs text-red-500 mt-1">{auth.failureCode}: {auth.failureMessage}</p>
        )}
      </div>

      {/* Donor */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Buyer</h4>
        <div className="space-y-0.5">
          <Row label="Name" value={formatPersonName(donor?.name, instrument?.accountHolderName)} />
          <Row label="Email" value={donor?.email || "—"} />
          <Row label="Phone" value={donor?.phone || "—"} />
          {auth.finixBuyerIdentityId && (
            <Row label="Identity" value={<CopyableIdBadge id={auth.finixBuyerIdentityId} />} />
          )}
        </div>
      </div>

      {/* Authorization details */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Authorization</h4>
        <div className="space-y-0.5">
          <Row label="ID" value={<CopyableIdBadge id={auth.finixAuthorizationId} />} />
          {auth.authorizationCode && <Row label="Auth Code" value={auth.authorizationCode} />}
          {auth.traceId && <Row label="Trace ID" value={<CopyableIdBadge id={auth.traceId} />} />}
          <Row label="Created" value={formatDateTime(auth.createdAtFinix)} />
          <Row label="Expires" value={formatDateTime(auth.expiresAt)} />
          {auth.isVoid && <Row label="Void State" value={titleCase(auth.voidState)} />}
        </div>
      </div>

      {/* Payment instrument */}
      <div className="px-5 py-4 border-b border-slate-100">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Payment Instrument</h4>
        <div className="space-y-0.5">
          {instrument ? (
            <>
              <Row
                label="Type"
                value={instrument.cardBrand || (instrument.bankLast4 ? "Bank Account" : "—")}
              />
              <Row
                label="Last Four"
                value={instrument.cardLast4 || instrument.bankLast4 || "—"}
              />
              {instrument.cardExpirationMonth && instrument.cardExpirationYear && (
                <Row label="Expires" value={`${instrument.cardExpirationMonth}/${instrument.cardExpirationYear}`} />
              )}
              <Row label="CVV Check" value={titleCase(auth.cvvVerification ?? instrument.securityCodeVerification)} />
              <Row label="AVS Check" value={titleCase(auth.addressVerification ?? instrument.addressVerification)} />
            </>
          ) : (
            <>
              <Row label="CVV Check" value={titleCase(auth.cvvVerification)} />
              <Row label="AVS Check" value={titleCase(auth.addressVerification)} />
              {auth.finixPaymentInstrumentId && (
                <Row label="Instrument" value={<CopyableIdBadge id={auth.finixPaymentInstrumentId} />} />
              )}
            </>
          )}
        </div>
      </div>

      {/* Linked transfer */}
      {auth.finixTransferId && (
        <div className="px-5 py-4">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Linked Payment</h4>
          <Row
            label="Transfer"
            value={
              <a
                href={`/merchant/transactions/payments?id=${auth.finixTransferId}`}
                className="text-blue-600 hover:underline font-mono text-xs"
              >
                {auth.finixTransferId.slice(0, 12)}…
              </a>
            }
          />
        </div>
      )}
    </div>
  );
}
