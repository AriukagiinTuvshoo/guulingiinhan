const CACHE_NAME = 'guulingiinhan-public-v1';
const PUBLIC_ASSETS = ['/', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
    self.clients.claim(),
  ]));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Authenticated pages, API responses, photos and private records are never cached.
  if (!PUBLIC_ASSETS.includes(url.pathname)) return;
  if (url.pathname === '/' && event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname)));
});
