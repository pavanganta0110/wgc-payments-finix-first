import { NextResponse } from "next/server";
import { buildEmbedSessionCookie } from "@/lib/auth/embedLogin";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { SESSION_COOKIE_NAME } from "@/lib/auth/sessionConstants";
import { logDashboardAction } from "@/lib/dashboardAudit";
import type { PartnerEmbedLinkPayload } from "@/lib/partners/embedLink";
import type { EmbedUser } from "@/lib/partners/embedPasscode";

/** True when the request already carries this person's embedded session, so the passcode is not asked again. */
export function hasEmbedSessionFor(req: Request, user: EmbedUser): boolean {
  const cookie = req.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return false;
  const session = verifySessionToken(match.slice(SESSION_COOKIE_NAME.length + 1));
  return !!session && session.embedded === true && session.userId === user.id && session.churchId === user.churchId && session.authVersion === user.authVersion;
}

/** Signs the person in (an owner with the reduced embedded role) and sends the frame to the dashboard. Call only after the passcode is accepted. */
export async function startEmbeddedSession(req: Request, user: EmbedUser, payload: PartnerEmbedLinkPayload): Promise<NextResponse> {
  const sessionToken = createSessionToken({
    userId: user.id,
    email: user.email,
    role: (user.role === "owner" ? "admin" : user.role) as "admin" | "fundraiser" | "viewer",
    churchId: user.churchId,
    authVersion: user.authVersion,
    embedded: true,
  });

  const res = NextResponse.redirect(new URL("/merchant/dashboard", req.url), 303);
  res.headers.append("Set-Cookie", buildEmbedSessionCookie(SESSION_COOKIE_NAME, sessionToken));
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");

  try {
    await logDashboardAction({
      churchId: user.churchId,
      actorUserId: user.id,
      actorEmail: user.email,
      actorRole: user.role,
      action: "auth.embed_session_started",
      entityType: "user",
      entityId: user.id,
      metadata: { partnerId: payload.partnerId, via: "partner_embed_passcode" },
      req,
    });
  } catch (err) {
    console.error("Failed to audit partner embed session start:", err);
  }
  return res;
}
