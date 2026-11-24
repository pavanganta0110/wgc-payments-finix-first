import { NextResponse } from "next/server";
import { verifyPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { findEmbedUser, verifyEmbedPasscode } from "@/lib/partners/embedPasscode";
import { startEmbeddedSession } from "@/lib/partners/embedSession";

/** Checks the emailed code and, when it is right, starts the person's embedded session. */
export async function POST(req: Request) {
  const form = await req.formData();
  const link = typeof form.get("link") === "string" ? (form.get("link") as string) : "";
  const code = typeof form.get("code") === "string" ? (form.get("code") as string).replace(/\s/g, "") : "";

  const payload = verifyPartnerEmbedLinkToken(link);
  if (!payload) return NextResponse.redirect(new URL("/partner-embed", req.url), 303);
  const user = await findEmbedUser(payload);
  if (!user) return NextResponse.redirect(new URL(`/partner-embed?link=${encodeURIComponent(link)}&problem=1`, req.url), 303);

  if (!(await verifyEmbedPasscode(user.id, code))) {
    return NextResponse.redirect(new URL(`/partner-embed/passcode?link=${encodeURIComponent(link)}&sent=1&error=invalid`, req.url), 303);
  }
  return startEmbeddedSession(req, user, payload);
}
