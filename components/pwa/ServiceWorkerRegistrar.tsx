"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js once on mount. Intentionally minimal — no toast
 * spam, no prompts, no lifecycle UI. The SW takes care of skipWaiting
 * + clients.claim itself so a deploy reaches the user on next refresh.
 *
 * Registration rule: register everywhere EXCEPT localhost in dev. This
 * means:
 *   - production builds → register (the obvious case).
 *   - dev server tunneled through ngrok / cloudflared / a real hostname
 *     → register (lets you actually test PWA install + offline on a
 *     phone without doing a full prod build).
 *   - plain `pnpm dev` on http://localhost:3000 → skip, because SW
 *     caching of constantly-changing chunks during development causes
 *     "why isn't my edit showing up?" misery.
 *
 * Operators can force-disable by setting NEXT_PUBLIC_DISABLE_SW=1.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NEXT_PUBLIC_DISABLE_SW === "1") return;

    const hostname = window.location.hostname;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    const isProd = process.env.NODE_ENV === "production";
    if (!isProd && isLocalhost) return;

    // Wait for full load so SW registration doesn't compete with
    // hydration for bandwidth on cold loads.
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          // Surface to the console for debugging, but never block the app.
          console.warn("[sw] registration failed", err);
        });
    };

    if (document.readyState === "complete") {
      onLoad();
    } else {
      window.addEventListener("load", onLoad, { once: true });
      return () => window.removeEventListener("load", onLoad);
    }
  }, []);

  return null;
}
