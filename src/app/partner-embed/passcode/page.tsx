import { redirect } from "next/navigation";
import { Mail } from "lucide-react";
import { verifyPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { findEmbedUser, maskEmail } from "@/lib/partners/embedPasscode";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "That code is not right or has expired. Check the email and try again, or ask for a new code.",
  cooldown: "A code was just sent. Wait a minute before asking for another.",
  limited: "Too many codes were requested. Try again later.",
  send_failed: "We could not send the email. Try again in a moment.",
};

const button = "w-full metallic-gold px-8 py-3 text-sm font-bold rounded-xl shadow-lg text-slate-900";

/** The one-time code screen shown inside the partner's frame before the dashboard opens. */
export default async function PartnerEmbedPasscodePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const link = typeof params.link === "string" ? params.link : "";
  const payload = verifyPartnerEmbedLinkToken(link);
  if (!payload) redirect("/partner-embed");
  const user = await findEmbedUser(payload);
  if (!user) redirect(`/partner-embed?link=${encodeURIComponent(link)}&problem=1`);

  const sent = params.sent === "1";
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  return (
    <main className="max-w-md w-full mx-auto px-6 py-16 flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 bg-slate-100 text-slate-600">
        <Mail className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold text-slate-900 mb-3">Enter your code</h1>
      <p className="text-slate-600 mb-6">
        {sent ? `We emailed a 6-digit code to ${maskEmail(user.email)}.` : `To open your dashboard we will email a 6-digit code to ${maskEmail(user.email)}.`}
      </p>
      {error && <p role="alert" className="text-red-600 text-sm mb-4">{error}</p>}
      {sent && (
        <form method="post" action="/partner-embed/passcode/verify" className="w-full space-y-3 mb-4">
          <input type="hidden" name="link" value={link} />
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus aria-label="6-digit code" className="w-full text-center text-2xl tracking-widest border border-slate-300 rounded-xl py-3" />
          <button type="submit" className={button}>Open dashboard</button>
        </form>
      )}
      <form method="post" action="/partner-embed/passcode/send" className="w-full">
        <input type="hidden" name="link" value={link} />
        <button type="submit" className={sent ? "text-sm text-slate-600 underline" : button}>{sent ? "Send a new code" : "Email me a code"}</button>
      </form>
    </main>
  );
}
