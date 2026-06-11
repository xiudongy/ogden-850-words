// Service worker: cache-first for the fully static app shell.
// Bump CACHE_VERSION whenever any cached file changes.
const CACHE_VERSION = 'wordfun-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './words.js',
  './emoji-data.js',
  './manifest.json',
  './vendor/lucide.min.js',
  './fonts/nunito-latin.woff2',
  './fonts/nunito-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        // Cache same-origin successful responses so updated files heal the cache.
        if (resp.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
        }
        return resp;
      });
    })
  );
});
