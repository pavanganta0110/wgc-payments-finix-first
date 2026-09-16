import { NextResponse } from "next/server";
import { headers } from "next/headers";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * Twilio delivery-status callback for authentication SMS — the
 * StatusCallback URL sent with every send in src/lib/sms/authSmsSender.ts.
 * Twilio POSTs here (queued -> sent/delivered, or undelivered/failed) for
 * every message sent through the 2FA number; we record the outcome on the
 * matching AuthSmsSendLog row so delivery problems are visible without
 * needing to check the Twilio console.
 *
 * This is the one inbound endpoint that must verify it's actually Twilio
 * calling — see verifyTwilioSignature below. Unauthenticated by design
 * otherwise (Twilio can't hold our session cookies), so the signature is
 * the only gate; nothing here is exploitable beyond that (it only ever
 * updates a status field keyed by a provider message ID Twilio itself
 * generated, never anything an attacker could use to enumerate or act on
 * a user's account).
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);

  const headerList = await headers();
  const signature = headerList.get("x-twilio-signature");
  const callbackUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://www.wgcpayments.com"}/api/webhooks/twilio/auth-status`;

  if (!authToken || !signature || !verifyTwilioSignature(authToken, callbackUrl, params, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const messageSid = params.get("MessageSid");
  const status = params.get("MessageStatus");
  if (!messageSid || !status) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  await prisma.authSmsSendLog.updateMany({
    where: { providerMessageId: messageSid },
    data: {
      deliveryStatus: status.toUpperCase(),
      deliveryStatusAt: new Date(),
      errorCode: params.get("ErrorCode") || null,
    },
  });

  return NextResponse.json({ success: true });
}

/** Twilio's documented request-validation algorithm: sort the POST params
 * by key, append each key+value directly to the callback URL (no
 * separators), HMAC-SHA1 with the auth token, base64-encode, and compare
 * to the X-Twilio-Signature header. */
function verifyTwilioSignature(authToken: string, url: string, params: URLSearchParams, signature: string): boolean {
  const sortedKeys = Array.from(new Set(params.keys())).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params.get(key);
  }

  const expected = crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
