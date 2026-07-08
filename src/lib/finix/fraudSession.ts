"use client";

/**
 * Client-side helper for Finix's Fraud Detection API, per
 * docs.finix.com/guides/online-payments/fraud-and-risk/fraud-detection.
 *
 * Loads Finix.js, initializes Finix.Auth for a given merchant, and returns
 * the session key that must be sent as fraud_session_id on the first
 * Authorization/Transfer that debits the buyer's payment instrument in a
 * checkout session.
 *
 * Usage on a checkout/donation page:
 *   const fraudSessionId = await getFraudSessionId(merchantId);
 *   // include fraudSessionId as fraud_session_id in the payment request
 *   // sent to POST /api/... (which forwards it to finixClient.createTransfer)
 */

declare global {
  interface Window {
    Finix?: {
      Auth: (
        environment: "sandbox" | "live",
        merchantId: string,
        callback?: (sessionKey: string) => void
      ) => {
        getSessionKey: () => string;
        connect: (merchantId: string, callback?: (sessionKey: string) => void) => void;
      };
    };
  }
}

const FINIX_JS_URL = "https://js.finix.com/v/2/finix.js";

let scriptLoadPromise: Promise<void> | null = null;

function loadFinixScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("getFraudSessionId can only run in the browser"));
  }

  if (window.Finix) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${FINIX_JS_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Finix.js")));
      return;
    }

    const script = document.createElement("script");
    script.src = FINIX_JS_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Finix.js"));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Returns a fresh fraud_session_id for the given merchant. Call this once
 * per checkout session (e.g. on page load / when the donation form mounts),
 * and pass a new one whenever the buyer starts a new checkout session per
 * Finix's guidance (returning after time away, new browser/device, etc.).
 */
export async function getFraudSessionId(
  merchantId: string,
  environment: "sandbox" | "live" = (process.env.NEXT_PUBLIC_FINIX_ENV as "sandbox" | "live") || "sandbox"
): Promise<string> {
  await loadFinixScript();

  if (!window.Finix) {
    throw new Error("Finix.js failed to initialize on window");
  }

  const finixAuth = window.Finix.Auth(environment, merchantId);
  return finixAuth.getSessionKey();
}
