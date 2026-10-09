/** Verify install assets and the private-data boundary of the network-only worker. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const manifest = JSON.parse(await fs.readFile('public/manifest.webmanifest', 'utf8'));
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'));
for (const icon of manifest.icons) {
  const bytes = await fs.readFile(`public${icon.src}`);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const [width, height] = icon.sizes.split('x').map(Number);
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
}
const worker = await fs.readFile('public/sw.js', 'utf8');
const handlers = {};
let cacheTouches = 0;
let fetches = 0;
let offline = false;
const freshResponse = new Response('fresh network content', { headers: { 'Cache-Control': 'no-store' } });
vm.runInNewContext(worker, {
  self: { location: { origin: 'https://test.invalid' }, clients: { claim: async () => {} }, skipWaiting() {}, addEventListener(type, fn) { handlers[type] = fn; } },
  URL, Response,
  caches: new Proxy({}, { get() { cacheTouches++; throw Error('No Cache Storage access permitted'); } }),
  indexedDB: new Proxy({}, { get() { cacheTouches++; throw Error('No IndexedDB access permitted'); } }),
  fetch: async () => { fetches++; if (offline) throw Error('Offline'); return freshResponse; },
});
function invoke(url, mode = 'cors', method = 'GET') {
  let result;
  handlers.fetch({ request: { url, mode, method }, respondWith(value) { result = value; } });
  return result;
}
for (const endpoint of ['/api/v1/auth/me', '/api/v1/people', '/media/private-photo', '/_next/data/private.json']) {
  assert.equal(invoke(`https://test.invalid${endpoint}`), undefined);
}
assert.equal(invoke('https://test.invalid/api/v1/auth/login', 'cors', 'POST'), undefined);
assert.equal(invoke('https://backend.invalid/api/v1/people', 'navigate'), undefined);
assert.equal(await invoke('https://test.invalid/profile?person=private-id', 'navigate'), freshResponse);
offline = true;
const fallback = await invoke('https://test.invalid/profile?person=private-id', 'navigate');
assert.equal(fallback.status, 503);
assert.equal(fallback.headers.get('Cache-Control'), 'no-store');
const html = await fallback.text();
assert.ok(html.includes('Интернет холболт тасарлаа'));
assert.ok(!html.includes('private-id'));
assert.equal(cacheTouches, 0);
assert.equal(fetches, 2);
console.log('PASS manifest/PNG dimensions; network navigation; offline fallback; auth/API/media/cache isolation');
