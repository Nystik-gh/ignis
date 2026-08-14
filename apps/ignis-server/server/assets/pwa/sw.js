/* Ignis service worker — network-first with runtime cache fallback.
 * The vault lives server-side, so vault data and sync must always stay fresh:
 * only same-origin GETs of app-shell assets are cached, and only as a
 * fallback when the network is unavailable. API and vault paths are never
 * intercepted. */
"use strict";

const VERSION = "ignis-pwa-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API, vault content, or auth paths.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/vault-files/") ||
    url.pathname.startsWith("/login") ||
    url.pathname.startsWith("/continue")
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (err) {
        const cached = await cache.match(req, { ignoreSearch: true });
        if (cached) return cached;
        throw err;
      }
    })(),
  );
});
