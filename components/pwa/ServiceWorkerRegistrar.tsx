"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js once on mount. Intentionally minimal — no toast
 * spam, no prompts, no lifecycle UI. The SW takes care of skipWaiting
 * + clients.claim itself so a deploy reaches the user on next refresh.
 *
 * We only register in production; the dev server invalidates assets
 * constantly and a SW would happily serve stale chunks back to it,
 * making "why isn't my edit showing up?" a much harder question.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

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
