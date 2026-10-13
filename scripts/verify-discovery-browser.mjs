/* Local-only browser -> proxy -> real FastAPI/PostgreSQL synthetic fixture.
 * Fixture credentials are disposable, read from an ignored local file and never logged. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(await fs.readFile('.p12_4_local_fixture.json', 'utf8'));
const backend = 'http://127.0.0.1:8014'; const base = 'http://127.0.0.1:3014';
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext();
await context.route('https://ci.invalid/api/v1/**', async route => {
  const request = route.request(); const url = new URL(request.url());
  const cors = { 'access-control-allow-origin': base, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type' };
  if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  const response = await fetch(backend + url.pathname + url.search, { method: request.method(), headers: { cookie: `${fixture.cookie_name}=${fixture.cookie}`, ...(request.postData() ? { 'content-type': 'application/json', origin: base } : {}) }, body: request.postData() || undefined });
  await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...cors }, body: Buffer.from(await response.arrayBuffer()) });
});
const page = await context.newPage();
const errors = []; page.on('pageerror', error => errors.push(error.message));
const widths = [320, 390, 768, 1024, 1440]; const measurements = [];
const paths = ['/search', '/relationships', `/profile?person=${fixture.person_id}`, '/tree', '/stories/new', '/archives/new', '/memories/new', `/stories/${fixture.story_id}`, `/archives/${fixture.archive_id}`, `/memories/${fixture.memory_id}`, '/invite'];
await fs.mkdir('.p12_4_artifacts', { recursive: true });
try {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    for (const path of paths) {
      const separator = path.includes('?') ? '&' : '?'; const started = performance.now();
      await page.goto(`${base}${path}${separator}family=${fixture.family_id}`);
      await page.waitForLoadState('networkidle');
      if (path === '/tree') await page.locator('.family-map-node').first().waitFor({ timeout: 20000 });
      if (path.startsWith('/profile')) await page.locator('.person-timeline ol').waitFor({ timeout: 20000 });
      const metrics = await page.evaluate(() => {
        const visible = el => { const rect = el.getBoundingClientRect(); const style = getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && !el.closest('details:not([open])') && rect.left >= 0 && rect.right <= innerWidth; };
        return { overflow: document.documentElement.scrollWidth > innerWidth + 2, treeNodes: document.querySelectorAll('.family-map-node').length, unnamedButtons: [...document.querySelectorAll('button')].filter(visible).filter(el => !el.getAttribute('aria-label') && !el.textContent.trim()).length, unlabeledInputs: [...document.querySelectorAll('input,select,textarea')].filter(visible).filter(el => !el.labels?.length && !el.getAttribute('aria-label')).length, heading: document.querySelector('h1')?.textContent };
      });
      assert.equal(metrics.overflow, false, `${width} ${path}: body overflow`);
      assert.equal(metrics.unnamedButtons, 0, `${width} ${path}: unnamed button`);
      assert.equal(metrics.unlabeledInputs, 0, `${width} ${path}: unlabeled input`);
      if (path === '/tree') { if (!(metrics.treeNodes > 0 && metrics.treeNodes < 800)) { await page.screenshot({ path: '.p12_4_artifacts/tree-failure.png', fullPage: true }); console.log(JSON.stringify({ width, path, metrics, errors })); } assert.ok(metrics.treeNodes > 0 && metrics.treeNodes < 800, 'Tree windowing did not reduce rendered nodes'); }
      measurements.push({ width, path, ready_ms: Math.round(performance.now() - started), ...metrics });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/search?family=${fixture.family_id}`); await page.getByRole('searchbox').fill('Fixture'); await page.getByRole('button', { name: 'Хайх', exact: true }).click();
  await page.locator('.discovery-group').last().waitFor(); assert.equal(await page.locator('.discovery-group').count(), 4); assert.ok(await page.locator('.discovery-results a').count() >= 4);
  await page.screenshot({ path: '.p12_4_artifacts/search-phone.png', fullPage: true });
  await page.goto(`${base}/relationships?family=${fixture.family_id}`); await page.waitForLoadState('networkidle');
  const fields = page.locator('.relationship-form fieldset');
  for (const [index, query] of [[0, 'Fixture'], [1, 'Fixture']]) { await fields.nth(index).getByRole('textbox').fill(query); await fields.nth(index).locator('.memory-person-results button').first().waitFor(); await fields.nth(index).locator('.memory-person-results button').nth(index).click(); }
  await page.getByRole('button', { name: 'Хамаарлыг харах', exact: true }).click(); await page.locator('.relationship-result').waitFor(); assert.ok(await page.locator('.relationship-path li').count() > 0);
  await page.screenshot({ path: '.p12_4_artifacts/relationship-phone.png', fullPage: true });
  await page.goto(`${base}/tree?family=${fixture.family_id}`); await page.waitForLoadState('networkidle');
  for (const mode of ['Ерөнхий', 'Ойрын холбоо', 'Жагсаалт']) { const button = page.getByRole('button', { name: mode, exact: true }); if (await button.isEnabled()) { await button.click(); await page.waitForTimeout(120); assert.equal(await button.getAttribute('aria-pressed'), 'true'); } }
  await page.getByRole('button', { name: 'Ерөнхий', exact: true }).click();
  await page.getByRole('button', { name: 'Мэдээллийг товчлох', exact: true }).click();
  assert.ok(await page.locator('.family-map--name,.family-map--initials').count());
  await page.getByRole('button', { name: 'Сонгосон хүний үр удам', exact: true }).click(); await page.getByRole('button', { name: 'Бүх салааг харах', exact: true }).click();
  await page.getByRole('button', { name: 'Товч', exact: true }).click(); await page.waitForTimeout(120);
  await page.emulateMedia({ media: 'print' }); assert.equal(await page.locator('.tree-print').isVisible(), true); assert.equal(await page.locator('.tree-print tbody tr').count(), 800); assert.equal(await page.locator('.app-shell__sidebar').isVisible(), false);
  await page.pdf({ path: '.p12_4_artifacts/tree-local-print.pdf', landscape: true }); await page.emulateMedia({ media: 'screen' });
  await page.goto(`${base}/profile?family=${fixture.family_id}&person=${fixture.person_id}`); await page.locator('.person-timeline ol').waitFor(); await page.screenshot({ path: '.p12_4_artifacts/timeline-phone.png', fullPage: true });
  await page.goto(`${base}/stories/new?family=${fixture.family_id}`); await page.getByLabel('Гарчиг *', { exact: true }).fill('Local linked story');
  await page.locator('#story-body').fill('Local writing with spaces and paragraphs.');
  await page.locator('.content-link-picker summary').click(); await page.locator('.content-link-picker input').fill('Fixture'); await page.locator('.content-link-picker li button').first().waitFor(); await page.locator('.content-link-picker li button').first().click();
  assert.ok(!(await page.locator('#story-body').inputValue()).includes('[[link:'));
  await page.locator('#story-body').fill('Local writing after linking. A second sentence.');
  await page.getByRole('button', { name: 'Түүх хадгалах', exact: true }).click(); await page.locator('.content-links a').first().waitFor();
  assert.equal(await page.locator('.content-links a').count(), 1);
  const savedPath = new URL(page.url()).pathname;
  await page.goto(`${base}${savedPath}/edit?family=${fixture.family_id}`); await page.locator('#story-body').waitFor(); assert.equal(await page.locator('#story-body').inputValue(), 'Local writing after linking. A second sentence.');
  await page.screenshot({ path: '.p12_4_artifacts/story-links-phone.png', fullPage: true });
  await page.goto(`${base}/search?family=00000000-0000-4000-8000-000000000000`); await page.locator('.discovery-state[role=alert]').waitFor(); assert.equal(await page.locator('.discovery-form').count(), 0);
  assert.deepEqual(errors, []);
  await fs.writeFile('docs/P12_4_LOCAL_BROWSER.json', JSON.stringify({ scope: 'Local headless Edge / actual local synthetic PostgreSQL and FastAPI / API transport proxy, not authenticated staging', widths, routeChecks: measurements.length, errors, measurements, interactions: ['unified four-kind search', 'two-person relationship path', 'Overview/Focus/List family map', 'semantic density control', 'branch focus and restore', 'authorized 800-person print (sidebar hidden)', 'canonical profile timeline', 'story link add/save/edit without raw IDs', 'invalid explicit family blocked'] }, null, 2));
  console.log(`PASS ${measurements.length} viewport/route checks and discovery interactions; no page exceptions`);
} catch (error) {
  await page.screenshot({ path: '.p12_4_artifacts/browser-failure.png', fullPage: true });
  console.log(JSON.stringify({ path: new URL(page.url()).pathname, heading: await page.locator('h1').allTextContents(), alerts: await page.locator('[role=alert]').allTextContents(), errors }));
  throw error;
} finally { await browser.close(); }
