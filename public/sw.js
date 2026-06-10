// Language Immersion — Service Worker
// Strategy: Cache-first for static assets, network-first for API calls

const CACHE_NAME = "tonge-v1";
const STATIC_ASSETS = [
  "/",
  "/subscribe",
  "/faq",
  "/manifest.json",
];

// Install — pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Pre-cache static pages (best effort — don't fail install if one misses)
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

// Activate — remove old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch — cache-first for static, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API, admin, or Stripe calls
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) {
    return; // Fall through to network
  }

  // Network-first for HTML pages (always fresh)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          // Cache a fresh copy
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match("/")))
    );
    return;
  }

  // Cache-first for everything else (JS, CSS, fonts from CDN)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        // Cache CDN resources (React, Babel from unpkg)
        if (event.request.url.includes("unpkg.com") || event.request.url.includes("cdn")) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});
