import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const familyId = '11111111-1111-4111-8111-111111111111';
const people = Array.from({ length: 800 }, (_, index) => ({
  id: `person-${index}`,
  first_name: `Хүн ${index}`,
  last_name: 'Туршилт',
  middle_name: null,
  birth_date: `${1900 + (index % 100)}-01-01`,
  is_alive: index % 7 !== 0,
  death_date: index % 7 === 0 ? `${1950 + (index % 70)}-01-01` : null,
  profile_photo_url: null,
  branch_id: index > 500 ? 'branch-b' : 'branch-a',
  branch_name: index > 500 ? 'Б салбар' : 'А салбар',
}));
const tree = {
  persons: people,
  parent_child_relationships: Array.from({ length: 797 }, (_, index) => ({
    id: `edge-${index}`,
    parent_id: `person-${Math.floor(index / 3)}`,
    child_id: `person-${index + 1}`,
    relationship_type: index % 19 ? 'biological' : 'adoptive',
  })),
  marriages: Array.from({ length: 70 }, (_, index) => ({
    id: `marriage-${index}`,
    person_1_id: `person-${600 + index * 2}`,
    person_2_id: `person-${601 + index * 2}`,
    status: index % 5 === 0 ? 'divorced' : 'married',
    start_date: null,
    end_date: null,
  })),
  root_person_id: 'person-0',
  lineage_root_person_id: 'person-0',
  linked_person_id: 'person-0',
  meta: { depth: 5, node_count: 800, node_limit: 1000, truncated: false },
};
// A disposable four-generation family for visual composition; never persisted to an API.
const portraitPeople = people.slice(0, 28).map((person, index) => ({ ...person, first_name: ['Ахмад', 'Эмээ', 'Долгор', 'Нансалмаа', 'Баавай', 'Бадамдорж', 'Саран', 'Наран', 'Бат', 'Оюун', 'Энх', 'Анужин', 'Тэмүүлэн', 'Номин', 'Билгүүн', 'Марал', 'Хосбаяр', 'Саруул', 'Туяа', 'Мөнх', 'Цэцэг', 'Ган', 'Амин', 'Хүслэн', 'Уянга', 'Тэнүүн', 'Эхлэл', 'Үргэлжлэл'][index], last_name: '', birth_date: null }));
const smallTree = { ...tree, persons: portraitPeople, root_person_id: 'person-0', lineage_root_person_id: 'person-0', linked_person_id: 'person-4', parent_child_relationships: [], marriages: [], meta: { depth: 5, node_count: 28, node_limit: 1000, truncated: false } };
const parent = (p, c) => smallTree.parent_child_relationships.push({ id: `p-${p}-${c}`, parent_id: `person-${p}`, child_id: `person-${c}`, relationship_type: 'biological' });
const marry = (a, b, status = 'married') => smallTree.marriages.push({ id: `m-${a}-${b}`, person_1_id: `person-${a}`, person_2_id: `person-${b}`, status, start_date: null, end_date: null });
marry(0, 1);
for (let i = 2; i <= 5; i++) { parent(0, i); parent(1, i); marry(i, i + 4, i === 3 ? 'widowed' : 'married'); for (let j = 0; j < 2; j++) { const c = 10 + (i - 2) * 2 + j; parent(i, c); parent(i + 4, c); } }
for (let i = 0; i < 4; i++) { marry(10 + i, 18 + i, i === 1 ? 'divorced' : 'married'); parent(10 + i, 22 + i); parent(18 + i, 22 + i); }
parent(26, 27);
let activeTree = smallTree;

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
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next server stopped: ${serverOutput}`);
    try { const response = await fetch(`${base}/login`); if (response.ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, `Next server did not start: ${serverOutput}`);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const context = await browser.newContext();
  await context.route('https://ci.invalid/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    let status = 200;
    let body = null;
    if (path === '/auth/me') body = { id: 'user-1', email: 'fixture@example.test', display_name: 'Responsive QA', person_id: 'person-0' };
    else if (path === '/families') body = [{ id: familyId, name: 'Туршилтын гэр бүл', description: null, role: 'owner' }];
    else if (path === '/admin/me') { status = 403; body = { detail: 'Forbidden' }; }
    else if (path === '/announcements') body = [];
    else if (path === '/shared-lineage/donation-info') body = null;
    else if (path.includes(`/families/${familyId}/tree`)) body = activeTree;
    else if (path === `/families/${familyId}/persons/search`) body = { items: [{ id: 'person-250', name: 'Туршилт Хүн 250', birth_year: 1950, family_name: null, branch_name: 'А салбар' }], page: 1, page_size: 25, total: 1, has_next: false };
    else if (path === `/families/${familyId}/link-requests`) body = [];
    else if (path === `/families/${familyId}/persons/person-0`) body = { ...people[0], gender: 'unknown', birth_place: null, death_place: null, nickname: null, short_description: null, visibility: 'family', can_edit_profile: true, lineage_id: null, lineage_name: null, branch_id: null, branch_name: null, parents: [], children: [], spouses: [] };
    else { status = 404; body = { detail: 'Synthetic browser fixture has no route' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1440];
  const measurements = [];
  await fs.mkdir('.family-map-artifacts', { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    const started = performance.now();
    await page.goto(`${base}/tree?family=${familyId}`);
    await page.locator('.family-map-node').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => {
      const scene = document.querySelector('.family-map__scene');
      return scene && Number(scene.dataset.scale) <= .71 && document.querySelectorAll('.family-map-node').length >= 6;
    });
    const metrics = await page.evaluate(() => {
      const map = document.querySelector('.family-map');
      const viewport = document.querySelector('.family-map__viewport');
      const visibleButtons = [...document.querySelectorAll('.family-map button:not(.family-map-node)')].filter((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return {
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        mapOverflow: map ? map.scrollWidth > map.clientWidth + 2 : true,
        intentionalCanvas: viewport ? getComputedStyle(viewport).overflow === 'hidden' && getComputedStyle(viewport).touchAction === 'none' : false,
        renderedNodes: document.querySelectorAll('.family-map-node').length,
        connectors: document.querySelectorAll('.family-map__edge').length,
        minTouchHeight: Math.min(...visibleButtons.map((button) => button.getBoundingClientRect().height)),
        mode: document.querySelector('.family-map')?.className,
      };
    });
    assert.equal(metrics.pageOverflow, false, `${width}: no accidental page overflow`);
    assert.equal(metrics.mapOverflow, false, `${width}: map shell does not overflow horizontally`);
    assert.equal(metrics.intentionalCanvas, true, `${width}: map uses a contained pan canvas`);
    assert.ok(metrics.renderedNodes > 0 && metrics.renderedNodes <= 240, `${width}: rendering stays bounded`);
    assert.ok(metrics.renderedNodes >= 6, `${width}: a meaningful family region is visible, not one giant person card`);
    assert.ok(metrics.connectors > 0, `${width}: real parent/spouse connectors are visible`);
    assert.ok(metrics.minTouchHeight >= 43, `${width}: visible map controls retain touch targets`);
    assert.match(metrics.mode, /family-map--overview/, `${width}: overview is the default`);
    measurements.push({ width, readyMs: Math.round(performance.now() - started), ...metrics });
    if ([320, 390, 1440].includes(width)) await page.screenshot({ path: `.family-map-artifacts/tree-${width}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/tree?family=${familyId}`);
  await page.locator('.family-map-node').first().waitFor();
  await page.getByRole('button', { name: 'Бүгдийг харах', exact: true }).click();
  const viewport = page.locator('.family-map__viewport');
  const box = await viewport.boundingBox();
  const beforePan = await page.locator('.family-map__scene').getAttribute('style');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 70);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height - 30, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.notEqual(await page.locator('.family-map__scene').getAttribute('style'), beforePan, 'drag changes camera');
  await page.getByRole('button', { name: 'Сонгосон хүн рүү', exact: true }).click();
  await page.locator('#tree-person-person-4').click();
  await page.getByRole('dialog', { name: 'Сонгосон хүний мэдээлэл' }).waitFor();
  await page.getByRole('button', { name: 'Хүний мэдээллийг хаах' }).click();
  await page.getByRole('button', { name: 'Ойрын холбоо', exact: true }).click();
  await page.locator('.family-map--focus').waitFor();
  assert.ok(await page.locator('.family-map-node').count() < 28, 'focus bounds local context');
  await page.screenshot({ path: '.family-map-artifacts/tree-focus-390.png', fullPage: true });
  await page.getByRole('button', { name: 'Жагсаалт', exact: true }).click();
  await page.locator('.family-map-list').waitFor();
  assert.ok(await page.locator('.family-map-list li').count() > 0, 'list fallback exposes semantic people rows');
  await page.getByRole('button', { name: 'Ерөнхий', exact: true }).click();
  activeTree = tree;
  await page.goto(`${base}/tree?family=${familyId}`);
  await page.locator('.family-map-node').first().waitFor();
  assert.ok(await page.locator('.family-map-node').count() <= 240, '800-person map window stays bounded');
  await page.getByLabel('Гэр бүлийн хүн хайх', { exact: true }).fill('Хүн 250');
  await page.getByRole('button', { name: /Туршилт Хүн 250/ }).click();
  await page.locator('.family-map--focus').waitFor();
  await page.getByRole('button', { name: 'Хүний мэдээллийг хаах' }).click();
  assert.match(page.url(), /person=person-250/, 'search focuses the requested canonical person');
  assert.ok(await page.locator('.family-map-node').count() < 50, 'search opens a bounded local family context');
  await page.getByRole('button', { name: 'Ерөнхий', exact: true }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Багасгах', exact: true }).click();
  await page.locator('.family-map--initials').waitFor();
  assert.match(page.url(), /map=overview/);
  await page.waitForTimeout(200);
  assert.match(page.url(), /map_x=/);
  assert.match(page.url(), /map_y=/);
  assert.match(page.url(), /map_width=/);
  const stateUrl = page.url();
  await page.getByRole('button', { name: 'Ойрын холбоо', exact: true }).click();
  await page.getByRole('button', { name: 'Сонгосон хүн рүү', exact: true }).click();
  await page.locator('#tree-person-person-250').click();
  await page.waitForTimeout(200);
  await page.getByRole('link', { name: 'Профайл үзэх', exact: true }).click();
  await page.waitForURL(/\/profile\?/);
  await page.goBack();
  await page.locator('.family-map--focus').waitFor();
  assert.match(page.url(), /person=person-250/);
  assert.match(page.url(), /map=focus/);
  assert.ok(stateUrl.includes('person=person-250'), 'selection is stored before profile navigation');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(250);
  const restoredDimensions = new URL(page.url());
  assert.ok(Number(restoredDimensions.searchParams.get('map_width')) > 800, 'camera reframes when viewport dimensions change');
  assert.deepEqual(errors, []);
  await fs.writeFile('docs/FAMILY_MAP_BROWSER_QA.json', JSON.stringify({
    scope: 'Local headless Edge with synthetic authorized API responses; excludes staging, production, network, physical devices and real user data',
    widths,
    measurements,
    interactions: ['canonical parent/spouse SVG connectors', 'drag camera', 'person → mobile detail sheet → close', 'bounded focus', 'List fallback', '800-person DOM window', 'search → focus', 'semantic zoom to initials', 'profile → Back camera state restoration'],
    errors,
  }, null, 2));
  console.log(`PASS ${widths.length} responsive widths, semantic modes, focus, list, and back-state restoration`);
} finally {
  if (browser) await browser.close();
  child.kill();
}
