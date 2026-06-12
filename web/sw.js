// Bump this date whenever you deploy changes — forces all users to get fresh files.
const CACHE = "cocktails-20260612184007";

const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./cocktails.json",
];

// Firebase SDK loads cross-origin from gstatic. Precache it explicitly in
// no-cors mode (opaque responses, which script tags can consume) so the app
// can boot offline; the runtime handler never caches cross-origin requests.
// Keep versions in sync with index.html.
const FIREBASE_SDK = [
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js",
];

// Install: cache everything up front. `cache: "reload"` bypasses the HTTP
// cache (Pages serves max-age=600), otherwise a rapid redeploy can fill the
// new versioned cache with files the browser cached up to 10 minutes ago.
// The SDK must use fetch + cache.put: addAll rejects opaque (no-cors)
// responses outright, which silently fails the whole install.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all([
      cache.addAll(APP_SHELL.map(url => new Request(url, { cache: "reload" }))),
      ...FIREBASE_SDK.map(url =>
        fetch(new Request(url, { mode: "no-cors", cache: "reload" }))
          .then(resp => cache.put(url, resp))
      ),
    ]))
  );
  self.skipWaiting();
});

// Activate: delete any old caches from previous versions.
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first with runtime caching for same-origin GETs; the precached
// Firebase SDK is served from cache; all other cross-origin requests
// (Firestore/auth API calls, recipe images) pass through to the network
// untouched — caching API responses would serve stale auth/data, and image
// responses are opaque (heavily quota-padded), so neither belongs in the cache.
self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (new URL(request.url).origin !== location.origin) {
    if (FIREBASE_SDK.includes(request.url)) {
      event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
    }
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
        return response;
      });
    })
  );
});
