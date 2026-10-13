/** Focused mobile file normalization + actual request-body/header transport checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import { prepareImageUpload, detectedImageType } from '../lib/image-upload.ts';

const png = await fs.readFile('public/icons/app-192.png');
const webp = await fs.readFile('public/heritage-steppe.webp');
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0xff, 0xd9]);
const variants = [
  { bytes: png, name: 'IPHONE.PNG', mime: '', expected: 'image/png', suffix: '.png' },
  { bytes: jpeg, name: 'CAMERA.JPEG', mime: 'image/jpg', expected: 'image/jpeg', suffix: '.jpg' },
  { bytes: jpeg, name: 'EXPORTED.HEIC', mime: '', expected: 'image/jpeg', suffix: '.jpg' },
  { bytes: webp, name: 'FAMILY.WEBP', mime: 'application/octet-stream', expected: 'image/webp', suffix: '.webp' },
  { bytes: png, name: 'Намрын зураг.jpg', mime: 'image/jpeg', expected: 'image/png', suffix: '.png' },
];
const received = [];
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received.push({ method: request.method, type: request.headers['content-type'], name: decodeURIComponent(request.headers['x-file-name']), body: Buffer.concat(chunks) });
  response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  for (const variant of variants) {
    const original = new File([variant.bytes], variant.name, { type: variant.mime });
    const prepared = await prepareImageUpload(original);
    assert.equal(prepared.type, variant.expected);
    assert.ok(prepared.name.endsWith(variant.suffix));
    await fetch(`http://127.0.0.1:${server.address().port}/photo`, { method: 'POST', body: prepared, headers: { 'Content-Type': prepared.type, 'X-File-Name': encodeURIComponent(prepared.name) } });
    const actual = received.at(-1);
    assert.equal(actual.method, 'POST'); assert.equal(actual.type, variant.expected);
    assert.equal(actual.name, prepared.name);
    assert.deepEqual(actual.body, Buffer.from(variant.bytes));
  }
  await assert.rejects(prepareImageUpload(new File(['bad content'], 'renamed.JPG', { type: 'image/jpeg' })), /Файлын нэрийг солих/);
  await assert.rejects(prepareImageUpload(new File([], 'empty.png')), /Хоосон/);
  await assert.rejects(prepareImageUpload(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'too-large.png')), /10 МБ/);
  const heic = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('heic')]);
  assert.equal(detectedImageType(heic), 'image/heic');
  await assert.rejects(prepareImageUpload(new File([heic], 'camera.HEIC', { type: 'image/heic' })), /JPEG.*Most Compatible/);
  console.log('PASS five MIME/filename variants with actual HTTP transport; false format/empty/size rejection; honest HEIC fallback');
} finally { await new Promise(resolve => server.close(resolve)); }
