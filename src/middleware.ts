import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SESSION_COOKIE_NAME = 'wgc_session';

// Public admin auth pages — reachable without a session, everything else
// under /admin and /api/admin requires one. Deliberately duplicates the
// signature-only half of src/lib/auth/session.ts's verifySessionToken
// rather than importing it, since that file now imports the Prisma client
// (for getAdminSession's DB-backed invalidation check), which isn't
// Edge-middleware-safe. Full DB-backed checks (disabled account,
// password-changed-since-issued) happen in getAdminSession() at the page
// level; this is the fast, stateless first gate.
const PUBLIC_ADMIN_PATHS = ['/admin/login', '/admin/forgot-password', '/admin/reset-password', '/admin/accept-invite'];

// The login/forgot-password APIs must themselves be reachable without a
// session — otherwise nobody could ever log in. validate-reset-token and
// set-password are shared with the merchant flow and live under
// /api/merchant, so they're outside this middleware's /api/admin matcher.
const PUBLIC_ADMIN_API_PATHS = ['/api/admin/login', '/api/admin/forgot-password'];

// Uses the Web Crypto API (globalThis.crypto), not Node's `crypto` module —
// this middleware runs on Vercel's Edge runtime, which doesn't have Node
// built-ins. Node's crypto.createHmac (used to sign the cookie in
// src/lib/auth/session.ts) and Web Crypto's HMAC-SHA256 produce identical
// signatures for the same UTF-8 key/message bytes, so this can verify
// tokens issued by the Node-side signer without needing to match runtimes.
let cachedKey: CryptoKey | null = null;
let cachedSecret: string | null = null;

async function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey && cachedSecret === secret) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  cachedSecret = secret;
  return cachedKey;
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyAdminSessionCookie(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return false;

  const [payloadB64, signatureB64] = token.split('.');
  if (!payloadB64 || !signatureB64) return false;

  try {
    const key = await getHmacKey(secret);
    const signatureBytes = base64urlToBytes(signatureB64);
    const payloadBytes = new TextEncoder().encode(payloadB64);
    const valid = await crypto.subtle.verify('HMAC', key, signatureBytes as BufferSource, payloadBytes as BufferSource);
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(base64urlToBytes(payloadB64)));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return false;
    return payload.role === 'wgc_admin' || payload.role === 'wgc_super_admin';
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const isAdminPagePath = pathname.startsWith('/admin');
  const isAdminApiPath = pathname.startsWith('/api/admin');
  const isTestPath = pathname.startsWith('/api/test');

  if (isTestPath) {
    if (process.env.NODE_ENV !== 'production' && !process.env.TEST_WEBHOOK_SECRET) {
      // Allow unauthenticated test access in local dev if no secret configured
      return NextResponse.next();
    }
    // No admin session concept applies to /api/test — leave its own auth
    // (TEST_WEBHOOK_SECRET, checked by the route itself) as the gate.
    return NextResponse.next();
  }

  if (isAdminPagePath && PUBLIC_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  if (isAdminApiPath && PUBLIC_ADMIN_API_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  if (isAdminPagePath || isAdminApiPath) {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const authed = await verifyAdminSessionCookie(token);

    if (!authed) {
      if (isAdminApiPath) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const loginUrl = new URL('/admin/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*', '/api/test/:path*'],
}
