import { NextResponse } from "next/server";
import { verifyPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { findEmbedUser, issueEmbedPasscode } from "@/lib/partners/embedPasscode";
import { sendWgcEmail } from "@/lib/email";
import { MFA_CODE_TTL_MINUTES } from "@/lib/auth/mfaCode";

/** Emails the person a 6-digit code. Sent only to the address already on the organization's team. */
export async function POST(req: Request) {
  const form = await req.formData();
  const link = typeof form.get("link") === "string" ? (form.get("link") as string) : "";
  const to = (status: string) => NextResponse.redirect(new URL(`/partner-embed/passcode?link=${encodeURIComponent(link)}&${status}`, req.url), 303);

  const payload = verifyPartnerEmbedLinkToken(link);
  if (!payload) return NextResponse.redirect(new URL("/partner-embed", req.url), 303);
  const user = await findEmbedUser(payload);
  if (!user) return NextResponse.redirect(new URL(`/partner-embed?link=${encodeURIComponent(link)}&problem=1`, req.url), 303);

  const issued = await issueEmbedPasscode(user);
  if (issued.status === "cooldown") return to("sent=1&error=cooldown");
  if (issued.status === "limited") return to("error=limited");

  const result = await sendWgcEmail({
    to: user.email,
    subject: "Your WGC Payments code",
    title: "Your sign-in code",
    bodyHtml: `<p>Your code is <strong style="font-size:24px;letter-spacing:4px">${issued.code}</strong></p><p>It expires in ${MFA_CODE_TTL_MINUTES} minutes. If you did not just open WGC Payments, you can ignore this email.</p>`,
  });
  if (!result.success) return to("error=send_failed");
  return to("sent=1");
}
