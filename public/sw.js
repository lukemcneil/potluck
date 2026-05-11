/* global self, caches, fetch, Response, URL, Promise */
/**
 * Potluck service worker.
 *
 * Goal: let the user pull up a recipe they've already viewed, without
 * an internet connection — useful in kitchens with bad wifi, on the
 * train, while traveling, etc.
 *
 * Strategy by request type:
 *   - /uploads/*       — cache-first (recipe photos are immutable per id).
 *   - /_next/static/*  — cache-first (hashed filenames; immutable).
 *   - /icons/*, /manifest.webmanifest — cache-first.
 *   - HTML navigations — stale-while-revalidate, falling back to a cached
 *     copy when offline. As a last resort we serve /offline.
 *   - /api/*, /_next/image*, anything with a query string we don't
 *     control, and non-GETs — passthrough (no SW involvement).
 *
 * The cache name is bumped via SW_VERSION whenever we ship a meaningful
 * change to caching behavior. Old caches are deleted on `activate`.
 */

const SW_VERSION = "v2";
const RUNTIME_CACHE = `potluck-runtime-${SW_VERSION}`;
const PAGES_CACHE = `potluck-pages-${SW_VERSION}`;
const PHOTOS_CACHE = `potluck-photos-${SW_VERSION}`;

// Paths that must be available offline. Pre-cached during install so a
// brand-new install that drops offline immediately still has the shell.
const PRECACHE_URLS = [
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
];

self.addEventListener("install", (event) => {
  // Activate the new SW immediately — important after a deploy so the
  // user gets the new caching rules without a full app restart.
  self.skipWaiting();
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
});

self.addEventListener("activate", (event) => {
  const expected = new Set([RUNTIME_CACHE, PAGES_CACHE, PHOTOS_CACHE]);
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("potluck-") && !expected.has(k))
          .map((k) => caches.delete(k)),
      );
      // Take control of any open tabs (otherwise the new SW only kicks
      // in on the next navigation).
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only intercept GETs. POST/PUT/DELETE go straight through; anything
  // else (e.g. server actions over POST) must reach the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin requests (Google avatar URLs, fonts CDN) — let them
  // through; we don't own the freshness contract.
  if (url.origin !== self.location.origin) return;

  // API routes are dynamic; never cache. Includes auth callback URLs,
  // upload endpoints, server-action invocations, etc.
  if (url.pathname.startsWith("/api/")) return;

  // Next.js image optimizer responses contain user data and live behind
  // a query string we don't fully control. Skip caching to avoid
  // serving wrong-resolution variants offline.
  if (url.pathname.startsWith("/_next/image")) return;

  // Stored recipe photos — immutable per id. Cache-first, fall back to
  // network on miss.
  if (url.pathname.startsWith("/uploads/")) {
    event.respondWith(cacheFirst(request, PHOTOS_CACHE));
    return;
  }

  // Hashed Next.js assets, manifest, icons — immutable. Cache-first.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  // Treat top-level HTML navigations + RSC fetches as page requests.
  // The Accept header contains "text/html" for the document itself; the
  // RSC payload requests come back as application/json with the
  // Next-Router-* headers. We just want to cache "what the page needs"
  // so the user can revisit offline.
  const accept = request.headers.get("accept") ?? "";
  if (request.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(htmlNavigationStrategy(request));
    return;
  }

  // Anything else (JS chunks already covered above, fonts, etc.) — go
  // network-first with cache fallback so we still work offline.
  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});

/**
 * Cache-first: return the cached copy if present, otherwise fetch and
 * store a clone. Failures bubble up to the caller (browser shows its
 * own offline UX for missing photos, which is fine).
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only cache full successful responses; partial / 4xx / 5xx responses
  // would persist a broken state.
  if (response.ok && response.status === 200) {
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Network-first with cache fallback. Used for non-immutable static-ish
 * assets: try the network for freshness, fall back to the cache when
 * offline.
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

/**
 * Web Push event: a notification payload arrived from our server.
 *
 * Payload shape (see `lib/push/send.ts`):
 *   { title, body, url, tag?, icon? }
 *
 * We render a single notification per event. `tag` lets the OS coalesce
 * repeated alerts on the same resource (e.g. "5 new ratings" collapses
 * to one banner).
 */
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Potluck", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Potluck";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icons/icon-192.svg",
    badge: "/icons/icon-192.svg",
    tag: payload.tag || undefined,
    data: { url: payload.url || "/feed" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Click on a notification: focus an open tab on the target URL when we
 * have one, otherwise open a new window.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/feed";
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.pathname === targetUrl.split("#")[0] && "focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              /* ignore navigation rejections */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});

/**
 * Pages get stale-while-revalidate semantics:
 *   - Serve the cached HTML immediately if we have it (fast + works
 *     offline).
 *   - Always also kick off a background fetch and update the cache so
 *     the next visit gets fresh content.
 *   - If we have no cached copy and the network is down, fall back to
 *     /offline so the user lands somewhere coherent instead of a
 *     "no internet" browser screen.
 */
async function htmlNavigationStrategy(request) {
  const cache = await caches.open(PAGES_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });

  const networkPromise = fetch(request)
    .then((response) => {
      // Don't cache redirects or auth-gated bounces; they'd lock the
      // user into the redirected URL forever offline.
      if (
        response.ok &&
        response.status === 200 &&
        !response.redirected
      ) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch((err) => {
      // Network failure — surface up; the caller decides between
      // cached copy and the offline page.
      throw err;
    });

  if (cached) {
    // Stale-while-revalidate: kick off the refresh but don't await.
    networkPromise.catch(() => {
      /* ignore — we already served from cache */
    });
    return cached;
  }

  try {
    return await networkPromise;
  } catch {
    const offline = await cache.match("/offline");
    if (offline) return offline;
    // Last-ditch fallback: a tiny inline response so the browser at
    // least shows *something* recognizable.
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Offline · Potluck</title>` +
        `<body style="font-family:system-ui;padding:2rem;text-align:center">` +
        `<h1>You're offline</h1><p>Reconnect to keep cooking.</p></body>`,
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
