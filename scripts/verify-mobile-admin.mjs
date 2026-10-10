/** Mobile shell, admin and PWA QA against disposable real localhost API only. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd(), frontend = 'http://127.0.0.1:8841', backend = 'http://127.0.0.1:8840', api = `${backend}/api/v1`;
const artifacts = path.join(root, '.integrated-qa'), results = [], children = [];
let browser, installContext, password = '', scenarioName = 'startup', pageErrors = 0, serverErrors = 0;
async function poll(fn, message, timeout = 15000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { if (await fn()) return; } catch { /* wait for asynchronous rendering */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.fail(message);
}
function launch(command, args, env) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Never print subprocess output: fixture credentials and private data stay local.
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
  children.push(child); return child;
}
async function scenario(name, fn) {
  scenarioName = name; const start = Date.now(); await fn();
  results.push({ name, pass: true, ms: Date.now() - start }); console.log(`PASS ${name}`);
}
async function login(context, identifier) {
  const response = await context.request.post(`${api}/auth/login`, { data: { identifier, password } });
  assert.equal(response.status(), 200, 'Real fixture login failed');
  const page = await context.newPage();
  page.on('pageerror', () => { pageErrors++; });
  page.on('response', response => { if (response.url().startsWith(api) && response.status() >= 500) serverErrors++; });
  return page;
}
async function settled(page) {
  await poll(() => page.evaluate(() => !document.querySelector('[aria-busy="true"]') && !/[Аа]чаалж байна|[Аа]чааллаж байна|хуудсыг нээж байна/.test(document.body.innerText)), 'UI remained loading');
}
async function headerMatches(context, page, photoUrl) {
  const expected = await context.request.get(api + photoUrl);
  assert.equal(expected.status(), 200);
  const bytes = await expected.body();
  await poll(async () => {
    const images = await page.locator('.app-shell__account-button img').evaluateAll(async images => {
      if (!images[0]?.complete || !images[0].naturalWidth) return [];
      return Array.from(new Uint8Array(await (await fetch(images[0].src)).arrayBuffer()));
    });
    return Buffer.from(images).equals(bytes);
  }, 'Header avatar does not match the signed-in person portrait');
}
async function within(page, locator, label, minTarget = 0) {
  await locator.waitFor({ state: 'visible' });
  // Visibility can precede the end of the drawer's slide-in transition.
  await poll(async () => {
    const box = await locator.boundingBox(), viewport = page.viewportSize();
    return box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1;
  }, `${label} never moved fully within the viewport`, 2000);
  const rect = await locator.boundingBox(); const viewport = page.viewportSize();
  assert.ok(rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, `${label} clipped outside viewport (${JSON.stringify(rect)} within ${JSON.stringify(viewport)})`);
  assert.ok(rect.width >= minTarget && rect.height >= minTarget, `${label} touch target smaller than ${minTarget}px`);
  return rect;
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'Document horizontal overflow');
  assert.equal(await page.locator('[role="alert"]:not(#__next-route-announcer__)').count(), 0, 'Unexpected application error');
}

try {
  await fs.access('.next/BUILD_ID'); await fs.mkdir(artifacts, { recursive: true });
  const runId = randomUUID(), startedAt = Date.now();
  const fixtureServer = launch(process.env.QA_PYTHON || path.join(root, '.p12_3_backend_venv/Scripts/python.exe'), ['backend/ops/qa_fixture_server.py'], { APP_ENV: 'test', GUULINGIINHAN_QA_RUN_ID: runId });
  let fixture;
  await poll(async () => {
    assert.ok(fixtureServer.exitCode === null, 'Disposable backend stopped');
    const candidate = JSON.parse(await fs.readFile(path.join(artifacts, 'fixture.json'), 'utf8'));
    if (!candidate.disposableLocalFixture || candidate.runId !== runId || Date.parse(candidate.generatedAt) < startedAt) return false;
    if (!(await fetch(`${backend}/health`)).ok) return false;
    fixture = candidate; return true;
  }, 'Fresh disposable fixture unavailable', 30000);
  assert.equal(fixture.baseUrl, api); password = fixture.password;
  const next = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '8841'], { NEXT_PUBLIC_API_BASE_URL: api });
  await poll(async () => next.exitCode === null && (await fetch(`${frontend}/login`)).ok, 'Local frontend unavailable', 30000);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const owner = await login(ownerContext, fixture.emails.familyAOwner), admin = await login(adminContext, fixture.emails.superAdmin);
  const family = fixture.familyIds.familyA;

  for (const width of [320, 375, 390, 768, 1024, 1440]) await scenario(`mobile shell controls, popovers and navigation ${width}px`, async () => {
    await owner.setViewportSize({ width, height: 1000 });
    await owner.goto(`${frontend}/dashboard?family=${family}`);
    const account = owner.getByRole('button', { name: 'Миний бүртгэлийн цэс', exact: true });
    const bell = owner.getByRole('button', { name: /^Мэдэгдэл(?:,|$)/ });
    await settled(owner);
    const a = await within(owner, account, 'Account button', width <= 768 ? 44 : 0);
    const b = await within(owner, bell, 'Notification bell', width <= 768 ? 44 : 0);
    assert.ok(a.x >= b.x + b.width - 1 || b.x >= a.x + a.width - 1 || a.y >= b.y + b.height - 1 || b.y >= a.y + a.height - 1, 'Account and bell overlap');
    await account.click();
    const menu = owner.getByRole('menu', { name: 'Хэрэглэгчийн цэс', exact: true });
    await within(owner, menu, 'Account menu');
    await menu.getByRole('menuitem', { name: 'Тохиргоо', exact: true }).click();
    await poll(() => owner.url().includes('/settings'), 'Account menu settings link did not navigate');
    await settled(owner); await noOverflow(owner);
    await bell.click();
    const notifications = owner.getByRole('dialog', { name: 'Мэдэгдлийн төв', exact: true });
    await within(owner, notifications, 'Notification panel');
    await owner.keyboard.press('Escape'); await notifications.waitFor({ state: 'hidden' });
    if (width <= 768) {
      const toggle = owner.getByRole('button', { name: 'Навигаци нээх', exact: true });
      if (await toggle.isVisible()) {
        await within(owner, toggle, 'Menu toggle', 44); await toggle.click();
        const drawer = owner.getByRole('dialog', { name: 'Authenticated application navigation', exact: true });
        const rect = await within(owner, drawer, 'Navigation drawer');
        const header = await owner.locator('.app-shell__header').boundingBox();
        assert.ok(!header || rect.y >= header.y + header.height - 1, 'Drawer overlaps header actions');
        await owner.keyboard.press('Escape'); await drawer.waitFor({ state: 'hidden' });
      }
    }
    await owner.screenshot({ path: path.join(artifacts, `mobile-admin-shell-${width}.png`) });
  });

  await scenario('tree family/shared mobile headers preserve profile and notification controls', async () => {
    for (const width of [320, 390, 768]) for (const view of ['family', 'shared']) {
      await owner.setViewportSize({ width, height: 1000 });
      const endpoint = view === 'shared' ? '/shared-lineage' : `/families/${family}/tree`;
      const loaded = owner.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === api + endpoint && response.status() === 200).then(response => response.finished());
      await owner.goto(`${frontend}/tree?view=${view}&family=${family}`); await loaded; await settled(owner);
      const account = owner.getByRole('button', { name: 'Миний бүртгэлийн цэс', exact: true });
      const bell = owner.getByRole('button', { name: /^Мэдэгдэл(?:,|$)/ });
      const a = await within(owner, account, `Tree ${view} account ${width}`, 44);
      const b = await within(owner, bell, `Tree ${view} bell ${width}`, 44);
      assert.ok(a.x >= b.x + b.width - 1 || b.x >= a.x + a.width - 1 || a.y >= b.y + b.height - 1 || b.y >= a.y + a.height - 1, `Tree ${view} header controls overlap ${width}`);
      await account.click(); await within(owner, owner.getByRole('menu', { name: 'Хэрэглэгчийн цэс', exact: true }), `Tree ${view} account popup ${width}`);
      await owner.keyboard.press('Escape');
      await bell.click(); const panel = owner.getByRole('dialog', { name: 'Мэдэгдлийн төв', exact: true });
      await within(owner, panel, `Tree ${view} notification popup ${width}`); await owner.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
      await noOverflow(owner);
      await owner.screenshot({ path: path.join(artifacts, `mobile-admin-tree-${view}-${width}.png`) });
    }
  });

  for (const width of [320, 390, 768, 1440]) await scenario(`admin overview and full navigation ${width}px`, async () => {
    await admin.setViewportSize({ width, height: 1000 }); await admin.goto(`${frontend}/admin`); await settled(admin);
    const nav = admin.getByRole('navigation', { name: 'Админ цэс', exact: true });
    await nav.waitFor({ state: 'visible' });
    for (const name of ['Хэрэглэгчид', 'Гэр бүл, удам', 'Мэдэгдэл', 'Өөрчлөлтийн түүх', 'Админ эрхүүд', 'Ерөнхий']) {
      await nav.getByRole('button', { name: new RegExp(name) }).click(); await settled(admin);
      await noOverflow(admin);
    }
    await admin.screenshot({ path: path.join(artifacts, `mobile-admin-overview-${width}.png`) });
    const ancestry = nav.getByRole('link', { name: /Эх мод|Удмын эх|Үндсэн удам/ });
    assert.equal(await ancestry.count(), 1, 'Admin ancestry navigation missing');
    await ancestry.click(); await poll(() => admin.url().includes('/admin/ancestry'), 'Ancestry link failed'); await settled(admin); await noOverflow(admin);
    await admin.screenshot({ path: path.join(artifacts, `mobile-admin-ancestry-${width}.png`) });
  });

  await scenario('people administration is gated; self profile remains editable', async () => {
    await owner.goto(`${frontend}/dashboard?family=${family}`); await settled(owner);
    assert.equal(await owner.getByRole('navigation', { name: 'Үндсэн навигаци' }).getByRole('link', { name: /^Хүмүүс/ }).count(), 0);
    assert.equal((await ownerContext.request.get(`${api}/families/${family}/people`)).status(), 403);
    assert.equal((await ownerContext.request.get(`${api}/families/${family}/persons`)).status(), 200);
    await owner.goto(`${frontend}/people?family=${family}`);
    await poll(() => owner.url().includes('/tree'), 'Ordinary directory route did not return to private tree');
    await owner.goto(`${frontend}/profile?family=${family}&person=${fixture.personIds.familyAOwnerPerson}`); await settled(owner);
    await owner.locator('#person-profile-photo').waitFor({ state: 'attached' });
    assert.equal(await owner.getByRole('button', { name: /Мэдээлэл засах/ }).count(), 1, 'Own edit affordance lost');
  });
  await scenario('mobile MIME normalization uploads own portrait and refreshes featured image', async () => {
    const bytes = await fs.readFile(fixture.imagePath);
    const oldAccountPhoto = await fs.readFile(fixture.alternateImagePath);
    assert.equal((await ownerContext.request.post(api + '/auth/me/photo', { data: oldAccountPhoto, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'old-account.png' } })).status(), 201);
    await owner.reload(); await settled(owner);
    await headerMatches(ownerContext, owner, '/auth/me/photo');
    const endpoint = `/families/${family}/persons/${fixture.personIds.familyAOwnerPerson}/profile-photo`;
    const uploaded = owner.waitForResponse(r => r.url() === api + endpoint && r.request().method() === 'POST');
    await owner.locator('#person-profile-photo').setInputFiles({ name: 'IPHONE_EXPORT.HEIC', mimeType: '', buffer: bytes });
    assert.equal((await uploaded).status(), 201);
    const featuredResponse = await ownerContext.request.get(`${api}/families/${family}/featured-person`);
    assert.equal(featuredResponse.status(), 200);
    const featuredPerson = await featuredResponse.json();
    assert.equal(featuredPerson?.id, fixture.personIds.familyAOwnerPerson, 'Synthetic featured person not persisted');
    assert.ok(featuredPerson.profile_photo_url, 'Featured person API omitted saved portrait');
    await headerMatches(ownerContext, owner, featuredPerson.profile_photo_url);
    await owner.goto(`${frontend}/dashboard?family=${family}`); await settled(owner);
    const portrait = owner.locator('.heritage-portrait img');
    await poll(() => portrait.evaluateAll(images => images.some(i => i.complete && i.naturalWidth > 0)), 'Saved person photo did not render on dashboard');
    const previous = await portrait.getAttribute('src');
    const response = await ownerContext.request.post(api + endpoint, { data: bytes, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'replacement.png' } });
    assert.equal(response.status(), 201); const value = await response.json();
    await owner.evaluate(detail => window.dispatchEvent(new CustomEvent('guulingiinhan:photo-changed', { detail })), { endpoint, hasPhoto: true, url: value.profile_photo_url });
    await poll(async () => (await portrait.getAttribute('src')) !== previous && await portrait.evaluate(i => i.complete && i.naturalWidth > 0), 'Stable dashboard portrait did not refresh');
    await headerMatches(ownerContext, owner, value.profile_photo_url);
    await owner.reload(); await settled(owner);
    await headerMatches(ownerContext, owner, value.profile_photo_url);
    await owner.goto(`${frontend}/profile?family=${family}&person=${fixture.personIds.rootFather}`); await settled(owner);
    await headerMatches(ownerContext, owner, value.profile_photo_url);
    await owner.goto(`${frontend}/settings?family=${family}`); await settled(owner);
    await owner.getByLabel('Аккаунтын зураг', { exact: true }).setInputFiles({ name: 'EMPTY_MIME.PNG', mimeType: '', buffer: bytes });
    const accountUpload = owner.waitForResponse(r => r.url() === api + '/auth/me/photo' && r.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Зураг хадгалах', exact: true }).click(); assert.equal((await accountUpload).status(), 201);
    await headerMatches(ownerContext, owner, value.profile_photo_url);
    await owner.goto(`${frontend}/profile?family=${family}&person=${fixture.personIds.familyAOwnerPerson}`); await settled(owner);
    const deleted = owner.waitForResponse(r => r.url() === api + endpoint && r.request().method() === 'DELETE');
    await owner.getByRole('button', { name: 'Профайл зургийг устгах', exact: true }).click(); assert.equal((await deleted).status(), 204);
    await headerMatches(ownerContext, owner, '/auth/me/photo');
  });
  await scenario('admin people and ancestry retain persistent navigation', async () => {
    await admin.goto(`${frontend}/admin/people`); await settled(admin);
    const nav = admin.getByRole('navigation', { name: 'Админ цэс' });
    await nav.getByRole('link', { name: /Эх мод/ }).click(); await settled(admin);
    assert.equal(await admin.getByRole('link', { name: /Админ руу буцах/ }).count(), 0);
    await nav.getByRole('link', { name: /^Хүмүүс/ }).click(); await settled(admin); await noOverflow(admin);
    await nav.getByRole('link', { name: /^Хэрэглэгчид/ }).click(); await settled(admin);
    assert.ok(admin.url().includes('section=users')); await noOverflow(admin);
  });
  await scenario('admin request count remains unknown while loading or unavailable', async () => {
    const pattern = `${api}/admin/shared-lineage/requests?*`;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await admin.route(pattern, async route => { await gate; await route.abort('failed'); });
    await admin.goto(`${frontend}/admin`);
    const metrics = admin.getByRole('region', { name: 'Системийн бүртгэл', exact: true });
    const pendingMetric = metrics.locator('div').filter({ has: admin.getByText('Хүлээгдэж буй хүсэлт', { exact: true }) });
    await pendingMetric.waitFor({ state: 'visible' });
    assert.equal(await pendingMetric.locator('strong').innerText(), '—', 'Loading request count was fabricated');
    release();
    await admin.getByRole('alert').filter({ hasText: 'Хүсэлт ба сүүлийн үйлдлийг ачаалж чадсангүй.' }).waitFor({ state: 'visible' });
    assert.equal(await pendingMetric.locator('strong').innerText(), '—', 'Failed request count was fabricated');
    await admin.unroute(pattern);
    await admin.getByRole('button', { name: 'Дахин ачаалах', exact: true }).click(); await settled(admin); await noOverflow(admin);
  });

  await scenario('PWA manifest actual PNG sizes and network-only worker privacy', async () => {
    const response = await ownerContext.request.get(`${frontend}/manifest.webmanifest`); assert.equal(response.status(), 200);
    const manifest = await response.json(); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.scope, '/');
    for (const size of [192, 512]) {
      const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === 'image/png'); assert.ok(icon);
      const image = await ownerContext.request.get(frontend + icon.src); assert.equal(image.status(), 200);
      const bytes = await image.body(); assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
    }
    await owner.goto(`${frontend}/settings?family=${family}`); await settled(owner);
    await poll(() => owner.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).some(r => r.active)), 'Application service worker was not registered');
    await owner.reload(); await settled(owner);
    assert.ok(await owner.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'Page is not controlled by worker');
    // Playwright newContext is incognito and Chromium intentionally disables
    // installing there. Use a fresh disposable normal profile for criteria.
    installContext = await chromium.launchPersistentContext(path.join(artifacts, `pwa-profile-${randomUUID()}`), { executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const installPage = await installContext.newPage(); await installPage.goto(`${frontend}/login`);
    await poll(() => installPage.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).some(r => r.active)), 'Install profile worker not active');
    const cdp = await installContext.newCDPSession(installPage);
    const browserManifest = await cdp.send('Page.getAppManifest');
    assert.equal(browserManifest.errors.length, 0, 'Chromium rejected application manifest');
    assert.equal(JSON.parse(browserManifest.data).display, 'standalone');
    const installability = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors, [], 'Chromium installability criteria failed');
    await cdp.detach(); await installContext.close(); installContext = null;
    // Visit private API and a private authenticated page, then assert no cache entries exist.
    assert.equal((await ownerContext.request.get(`${api}/auth/me`)).status(), 200);
    assert.deepEqual(await owner.evaluate(() => caches.keys()), [], 'Service worker stores private content in Cache Storage');
    await ownerContext.setOffline(true);
    await owner.goto(`${frontend}/settings?family=${family}`);
    await owner.getByRole('heading', { name: /Интернет холболт/ }).waitFor({ state: 'visible' });
    assert.equal(await owner.getByRole('button', { name: 'Миний бүртгэлийн цэс', exact: true }).count(), 0, 'Private authenticated page displayed offline');
    assert.deepEqual(await owner.evaluate(() => caches.keys()), []);
    await owner.screenshot({ path: path.join(artifacts, 'mobile-admin-offline.png') });
    await ownerContext.setOffline(false);
    await owner.goto(`${frontend}/settings?family=${family}`); await settled(owner); await noOverflow(owner);
  });
  await scenario('no browser JavaScript exceptions or unexpected real API failures', async () => {
    assert.equal(pageErrors, 0, 'Uncaught JavaScript errors'); assert.equal(serverErrors, 0, 'Unexpected API 5xx');
  });
} catch (error) {
  const message = String(error?.message || error).replaceAll(password || '\0', '[local credential]');
  results.push({ name: scenarioName, pass: false, error: message }); console.error(`FAIL ${scenarioName}: ${message}`); process.exitCode = 1;
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: path.join(artifacts, `mobile-admin-failure-${context === browser.contexts()[0] ? 'owner' : 'admin'}.png`) }).catch(() => {});
} finally {
  if (installContext) await installContext.close();
  if (browser) await browser.close();
  for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  const report = { checked_at: new Date().toISOString(), scope: 'Synthetic disposable localhost browser → real API → SQLite. No live staging or production mutations. Native OS install prompt not claimed; Chromium installability manifest/worker and offline privacy verified. One deliberate request-abort fault injection validates unknown loading/error counts.', mock_api: false, fault_injection: 'One aborted local admin request only; all normal scenarios use real API.', scenarios: results, passed: results.filter(r => r.pass).length, total: results.length };
  await fs.writeFile('docs/MOBILE_ADMIN_QA.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: report.passed, total: report.total, evidence: 'docs/MOBILE_ADMIN_QA.json' }));
}
