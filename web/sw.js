// Bump this date whenever you deploy changes — forces all users to get fresh files.
const CACHE = "cocktails-20260612073026";

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
// no-cors mode (opaque responses): script tags can consume opaque responses,
// but the runtime handler below never caches them (opaque ⇒ !response.ok),
// so without this the app can't boot offline. Keep versions in sync with
// index.html.
const FIREBASE_SDK = [
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js",
];

// Install: cache everything up front.
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => Promise.all([
      cache.addAll(APP_SHELL),
      cache.addAll(FIREBASE_SDK.map(url => new Request(url, { mode: "no-cors" }))),
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

// Fetch: cache-first for everything we pre-cached, network-first for the rest.
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Don't cache non-GET or error responses.
        if (event.request.method !== "GET" || !response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      });
    })
  );
});
