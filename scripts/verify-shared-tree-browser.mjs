import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const familyId = '11111111-1111-4111-8111-111111111111';
const id = (name) => `fixture-${name}`;
const person = (key, firstName, lastName = '') => ({
  id: id(key), first_name: firstName, last_name: lastName, middle_name: null, gender: 'unknown',
  birth_date: null, is_alive: true, death_date: null, shared_by_me: key.startsWith('child-'), profile_photo_url: null,
});
const sharedPersons = [
  person('root-yadam', 'Ядамсүрэн'), person('root-gund', 'Гүнд'),
  person('child-dolgor', 'Долгор'), person('child-nansalmaa', 'Нансалмаа'),
  person('child-baavai', 'Баавай'), person('child-badamdorj', 'Бадамдорж'),
  person('spouse-dolgor', 'Саруул'), person('spouse-nansalmaa', 'Мөнх'),
  person('spouse-baavai', 'Оюун'), person('spouse-badamdorj', 'Бат'),
  person('unlinked-private', 'Холбоогүй хүн'), person('unlinked-public', 'Тусдаа салбар'),
];
const sharedRelationships = ['child-dolgor', 'child-nansalmaa', 'child-baavai', 'child-badamdorj']
  .flatMap((child) => ['root-yadam', 'root-gund'].map((parent) => ({
    id: id(`edge-${parent}-${child}`), parent_id: id(parent), child_id: id(child), relationship_type: 'biological',
  })));
const sharedSpouses = [
  ['root-yadam', 'root-gund'], ['child-dolgor', 'spouse-dolgor'], ['child-nansalmaa', 'spouse-nansalmaa'],
  ['child-baavai', 'spouse-baavai'], ['child-badamdorj', 'spouse-badamdorj'],
].map(([a, b]) => ({ id: id(`marriage-${a}-${b}`), person_1_id: id(a), person_2_id: id(b), status: 'married' }));
const activeTree = {
  name: 'ГУУЛИНГИЙНХАН', root_person_id: id('root-yadam'), root_partner_person_id: id('root-gund'),
  persons: sharedPersons, relationships: sharedRelationships, spouses: sharedSpouses, my_person_id: null,
};
const candidates = [
  { person_id: id('candidate-child'), first_name: 'Туршилтын хүүхэд', last_name: 'QA', middle_name: null, is_alive: false, is_current_user: false },
  { person_id: id('candidate-spouse'), first_name: 'Туршилтын хань', last_name: 'QA', middle_name: null, is_alive: false, is_current_user: false },
];
const pendingRequests = [];
const requestPayloads = [];
let sharedTreeReads = 0;

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production', NEXT_PUBLIC_API_BASE_URL: 'https://ci.invalid/api/v1' },
});
let serverOutput = '';
child.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
child.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

let browser;
try {
  await fs.access('.next/BUILD_ID');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server stopped: ${serverOutput}`);
    try { const response = await fetch(`${base}/login`); if (response.ok) { ready = true; break; } } catch { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Next server did not start: ${serverOutput}`);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext();
  await context.route('https://ci.invalid/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    let status = 200;
    let body = null;
    if (path === '/auth/me') body = { id: 'fixture-user', email: 'qa@example.test', display_name: 'Browser QA', person_id: null };
    else if (path === '/families') body = [{ id: familyId, name: 'ГУУЛИНГИЙНХАН', description: null, role: 'owner' }];
    else if (path === '/admin/me') { status = 403; body = { detail: 'Forbidden' }; }
    else if (path === '/announcements') body = [{ id: 'fixture-notice', title: 'Туршилтын мэдээ', body: 'Зөвхөн browser fixture.' }];
    else if (path === '/shared-lineage/donation-info') body = {
      title: 'Туршилтын сан', purpose: 'Синтетик browser шалгалт', currency: 'MNT', bank_name: 'QA БАНК',
      account_name: 'Browser fixture', account_number: '0000000000', qr_image_url: null,
    };
    else if (path === '/shared-lineage' && request.method() === 'GET') { sharedTreeReads += 1; body = activeTree; }
    else if (path === `/families/${familyId}/root-connection/candidates`) body = candidates;
    else if (path === `/families/${familyId}/shared-ancestry-requests` && request.method() === 'GET') body = pendingRequests;
    else if (path === `/families/${familyId}/shared-ancestry-requests` && request.method() === 'POST') {
      const payload = request.postDataJSON();
      requestPayloads.push(payload);
      const candidate = candidates.find((item) => item.person_id === payload.person_id);
      const target = sharedPersons.find((item) => item.id === payload.target_person_id);
      assert.ok(candidate, 'the synthetic request can use only a fixture family member');
      assert.ok(target, 'the synthetic request must target a shared-root person');
      const created = {
        id: `fixture-request-${pendingRequests.length + 1}`, family_id: familyId, family_name: 'ГУУЛИНГИЙНХАН',
        person_id: payload.person_id, person_name: `${candidate.last_name} ${candidate.first_name}`.trim(),
        target_person_id: payload.target_person_id, target_name: target.first_name,
        kind: payload.kind, relationship_type: payload.relationship_type, status: 'pending',
        requested_at: '2026-10-09T00:00:00Z', decided_at: null,
      };
      pendingRequests.unshift(created);
      status = 201; body = created;
    } else if (path.startsWith(`/families/${familyId}/shared-ancestry-requests/`) && path.endsWith('/cancel') && request.method() === 'POST') {
      const requestId = path.split('/').at(-2);
      const existing = pendingRequests.find((item) => item.id === requestId);
      assert.ok(existing, 'only a pending fixture request can be cancelled');
      existing.status = 'cancelled';
      body = existing;
    } else { status = 404; body = { detail: `Synthetic fixture has no route: ${request.method()} ${path}` }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const familyUrl = `${base}/tree?view=shared&family=${familyId}`;
  const widths = [320, 390, 768, 1440];
  const measurements = [];
  await fs.mkdir('.shared-tree-artifacts', { recursive: true });

  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.goto(familyUrl);
    await page.getByRole('heading', { name: 'Гуулингийнхны их мод' }).waitFor({ timeout: 20000 });
    await page.locator('.family-map__viewport').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('.family-map-node').length > 0);
    const metrics = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
      shellOverflow: document.querySelector('.shared-tree-shell')?.scrollWidth > (document.querySelector('.shared-tree-shell')?.clientWidth ?? 0) + 2,
      mapOverflow: document.querySelector('.family-map')?.scrollWidth > (document.querySelector('.family-map')?.clientWidth ?? 0) + 2,
      viewportTouchAction: getComputedStyle(document.querySelector('.family-map__viewport')).touchAction,
      visibleNodes: document.querySelectorAll('.family-map-node').length,
      connectors: document.querySelectorAll('.family-map__edge').length,
    }));
    assert.equal(metrics.pageOverflow, false, `${width}px: no document-level horizontal overflow`);
    assert.equal(metrics.shellOverflow, false, `${width}px: shared tree shell has no horizontal overflow`);
    assert.equal(metrics.mapOverflow, false, `${width}px: map canvas is contained in the page`);
    assert.equal(metrics.viewportTouchAction, 'none', `${width}px: map retains its pan/pinch gesture surface`);
    assert.ok(metrics.visibleNodes > 0, `${width}px: shared family map renders people`);
    assert.ok(metrics.connectors > 0, `${width}px: relationship connectors render`);
    measurements.push({ width, ...metrics });
    if (width === 390 || width === 1440) await page.screenshot({ path: `.shared-tree-artifacts/shared-tree-${width}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(familyUrl);
  await page.locator('.family-map-node').first().waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.family-map-node').length >= 10);
  assert.equal(await page.locator('.family-map-node').count(), 10, 'root couple, four children and four spouses are present; unrelated people are filtered');
  for (const name of ['Ядамсүрэн', 'Гүнд', 'Долгор', 'Нансалмаа', 'Баавай', 'Бадамдорж', 'Саруул', 'Мөнх', 'Оюун', 'Бат']) {
    assert.ok(await page.locator('.family-map-node').filter({ hasText: name }).count(), `${name} appears on the shared tree`);
  }
  assert.equal(await page.locator('.family-map-node').filter({ hasText: 'Холбоогүй хүн' }).count(), 0, 'unlinked private person is not shown');
  assert.equal(await page.locator('.family-map-node').filter({ hasText: 'Тусдаа салбар' }).count(), 0, 'unlinked public person is not shown');
  assert.equal(await page.locator('.shared-ancestry__count strong').textContent(), '10', 'shared tree count includes only connected people');

  const near = async (first, second) => {
    const a = await page.locator(`#tree-person-${id(first)}`).boundingBox();
    const b = await page.locator(`#tree-person-${id(second)}`).boundingBox();
    assert.ok(a && b, `${first} and ${second} are visible in the map`);
    assert.ok(Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) < 100, `${first} and ${second} occupy the same generation row`);
  };
  await near('root-yadam', 'root-gund');
  await near('child-baavai', 'spouse-baavai');

  const donation = page.locator('.tree-shell-notice--fund');
  await donation.locator('summary').getByText('Туршилтын сан', { exact: true }).waitFor();
  assert.ok(await donation.locator('summary').innerText().then((text) => text.includes('0000000000')), 'shared donation number is visible in the compact tree banner');
  await donation.locator('summary').click();
  await page.locator('.shared-donation__bank').getByText('0000000000').waitFor();
  await donation.locator('summary').click();

  const bell = page.getByRole('button', { name: 'Мэдэгдэл, уншаагүй 1' });
  await bell.waitFor();
  await bell.click();
  const notifications = page.getByRole('dialog', { name: 'Мэдэгдлийн төв' });
  await notifications.getByText('Туршилтын мэдээ').waitFor();
  await page.keyboard.press('Escape');
  await notifications.waitFor({ state: 'detached' });

  const beforeRequests = await page.locator('.family-map-node').count();
  const childTarget = page.locator(`#tree-person-${id('child-dolgor')}`).locator('xpath=..');
  await childTarget.getByRole('button', { name: 'Долгор хүнтэй холбоо нэмэх' }).click();
  let dialog = page.getByRole('dialog', { name: 'Хүнтэй холбоо нэмэх' });
  await dialog.waitFor();
  assert.ok(await dialog.getByText('Долгор', { exact: true }).count(), 'child composer identifies the target person');
  await dialog.getByLabel('Миний гэр бүлийн хүн').selectOption(id('candidate-child'));
  await dialog.getByLabel(/Энэ холбоог шалгасан/).check();
  await dialog.getByRole('button', { name: 'Хүсэлт илгээх' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByRole('status').filter({ hasText: 'Админ баталсны дараа үндсэн мод шинэчлэгдэнэ' }).waitFor();
  assert.deepEqual(requestPayloads[0], {
    person_id: id('candidate-child'), target_person_id: id('child-dolgor'), kind: 'child', relationship_type: 'biological', share_consent: true,
  }, 'child request goes through the existing pending-review API contract');

  const spouseTarget = page.locator(`#tree-person-${id('child-baavai')}`).locator('xpath=..');
  await spouseTarget.getByRole('button', { name: 'Баавай хүнтэй холбоо нэмэх' }).click();
  dialog = page.getByRole('dialog', { name: 'Хүнтэй холбоо нэмэх' });
  await dialog.waitFor();
  await dialog.getByLabel('Хань', { exact: true }).check();
  await dialog.getByLabel('Миний гэр бүлийн хүн').selectOption(id('candidate-spouse'));
  await dialog.getByLabel(/Энэ холбоог шалгасан/).check();
  await dialog.getByRole('button', { name: 'Хүсэлт илгээх' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(requestPayloads[1], {
    person_id: id('candidate-spouse'), target_person_id: id('child-baavai'), kind: 'spouse', relationship_type: 'married', share_consent: true,
  }, 'spouse request uses the marriage relationship contract');

  const readsBeforePendingRefresh = sharedTreeReads;
  await page.getByRole('button', { name: 'Мод шинэчлэх' }).click();
  await page.waitForFunction(() => document.querySelector('.shared-ancestry__count strong')?.textContent === '10');
  assert.equal(await page.locator('.family-map-node').count(), beforeRequests, 'pending relative requests do not change shared tree nodes before admin approval');
  assert.equal(await page.locator('.family-map-node').filter({ hasText: 'Туршилтын хүүхэд' }).count(), 0, 'pending child remains outside the shared tree');
  assert.equal(await page.locator('.family-map-node').filter({ hasText: 'Туршилтын хань' }).count(), 0, 'pending spouse remains outside the shared tree');
  assert.equal(sharedTreeReads, readsBeforePendingRefresh + 1, 'tree reload reads the same fixture graph after pending requests');

  await page.getByRole('button', { name: 'Хүсэлт цуцлах' }).first().click();
  await page.getByText('Хүсэлт цуцлагдсан').waitFor();
  assert.equal(pendingRequests.filter((item) => item.status === 'cancelled').length, 1, 'request cancellation uses the existing cancel API');

  await page.locator(`#tree-person-${id('child-dolgor')}`).locator('xpath=..').getByRole('button', { name: 'Долгор хүнтэй холбоо нэмэх' }).click();
  dialog = page.getByRole('dialog', { name: 'Хүнтэй холбоо нэмэх' });
  await dialog.waitFor();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.locator(`#tree-person-${id('child-dolgor')}`).locator('xpath=..').getByRole('button', { name: 'Долгор хүнтэй холбоо нэмэх' }).click();
  dialog = page.getByRole('dialog', { name: 'Хүнтэй холбоо нэмэх' });
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Болих' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(errors, [], 'browser emitted no uncaught client errors');

  await fs.writeFile('docs/SHARED_TREE_BROWSER_QA.json', JSON.stringify({
    scope: 'Disposable local production build with synthetic ci.invalid responses only; no staging, production, or real family data changed.',
    route: '/tree?view=shared',
    widths,
    measurements,
    graph: { expectedVisiblePeople: 10, includes: ['root couple', 'four first-generation children', 'four spouses'], excludes: ['unlinked private person', 'unlinked public person'] },
    interactions: ['compact donation number and details', 'notification bell and Escape close', 'per-person child request', 'per-person spouse request', 'pending requests leave shared tree unchanged before approval', 'cancel pending request', 'composer Escape close', 'composer cancel button'],
    api: { syntheticChildAndSpouseRequests: requestPayloads.length, sharedTreeReads, pendingAfterCancellation: pendingRequests.filter((item) => item.status === 'pending').length },
    errors,
    screenshots: ['.shared-tree-artifacts/shared-tree-390.png', '.shared-tree-artifacts/shared-tree-1440.png'],
  }, null, 2));
  console.log('PASS shared-tree graph visibility, child/spouse request workflow, cancellation, Escape, bell/fund display, and 320/390/768/1440 responsive checks');
} finally {
  if (browser) await browser.close();
  child.kill();
}
