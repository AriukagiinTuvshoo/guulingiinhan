/* Network-only application worker. Intentionally no Cache Storage or IndexedDB. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html lang="mn"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Интернет холболт</title><body style="margin:0;padding:32px;background:#f5f0e5;color:#103c2e;font:18px/1.6 system-ui"><main style="max-width:440px;margin:15vh auto"><h1 style="font-size:28px">Интернет холболт тасарлаа</h1><p>Гэр бүлийн мэдээллээ харахын тулд интернетэд холбогдоод дахин ачаална уу.</p><button onclick="location.reload()" style="padding:12px 20px;border:0;border-radius:8px;background:#103c2e;color:white;font:inherit">Дахин ачаалах</button></main></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )));
});
