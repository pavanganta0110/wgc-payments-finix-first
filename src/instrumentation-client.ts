import posthog from "posthog-js";

// PostHog — Session Replay, Web Analytics, and Product Analytics from one
// install. Next.js auto-loads this file (src/instrumentation-client.ts) on
// the client before hydration; no provider/wrapper component is required.
//
// capture_pageview: "history_change" tracks App Router client-side
// navigations automatically (pushState/replaceState/popstate) without
// needing a separate usePathname/useSearchParams listener component.
//
// Confirmed against posthog-js's own source (extensions/history-autocapture.ts):
// this mode's constructor only records the current location as a baseline
// and listens for FUTURE history changes — it never fires a pageview for
// the very first load itself. A visitor who lands on one page and never
// navigates client-side would otherwise generate zero $pageview events at
// all (this is exactly what showed up as a failing Installation Health
// check even after pageleave/scroll-depth were confirmed working). The
// explicit posthog.capture("$pageview") call below covers that initial
// load; history_change's own listener covers every navigation after it —
// the two never double-count, since history_change only fires on a path
// change from what it already recorded as the starting location.
//
// Requires NEXT_PUBLIC_POSTHOG_KEY to be set — if it's missing, posthog-js
// itself is a no-op rather than throwing, so a misconfigured/unset key
// never breaks the app; it just silently doesn't send events.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    ui_host: "https://us.posthog.com",
    // Config-snapshot default per PostHog's current docs — pins the
    // behavior of every option we don't set explicitly below to this
    // dated snapshot, so a future posthog-js update changing its own
    // defaults can't silently change our behavior underneath us.
    defaults: "2026-05-30",
    capture_pageview: "history_change",
    capture_pageleave: true,
    capture_exceptions: true,
    person_profiles: "identified_only",
    loaded: (ph) => {
      ph.capture("$pageview");
    },
  });
}
