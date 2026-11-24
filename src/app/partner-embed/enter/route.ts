import { NextResponse } from "next/server";
import { verifyPartnerEmbedLinkToken } from "@/lib/partners/embedLink";
import { findEmbedUser } from "@/lib/partners/embedPasscode";
import { hasEmbedSessionFor } from "@/lib/partners/embedSession";

/**
 * Where the partner's frame lands once the organization is approved. The signed embed link
 * names the partner and the partner's own id for the organization; the organization and the
 * person are then looked up here, inside that partner's own organization, so a link can never
 * open anyone else's dashboard. The person is the CRM user named in the link when they are on
 * the organization's team, otherwise its owner.
 *
 * A link alone does not sign anyone in. Someone with no session yet is sent to the passcode
 * page (a code emailed to the person's own address); someone who already passed it in this
 * session goes straight to the dashboard. Every refusal looks the same and sends the frame
 * back to the page.
 */
export async function GET(req: Request) {
  const link = new URL(req.url).searchParams.get("link") ?? "";
  const back = (problem: boolean) => NextResponse.redirect(new URL(`/partner-embed?link=${encodeURIComponent(link)}${problem ? "&problem=1" : ""}`, req.url), 303);

  const payload = verifyPartnerEmbedLinkToken(link);
  if (!payload) return NextResponse.redirect(new URL("/partner-embed", req.url), 303);

  const user = await findEmbedUser(payload);
  if (!user) return back(true);

  const next = hasEmbedSessionFor(req, user) ? "/merchant/dashboard" : `/partner-embed/passcode?link=${encodeURIComponent(link)}`;
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
