/** Disposable real-API browser QA. Never connects to staging or production. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd();
const frontend = 'http://127.0.0.1:8841';
const backend = 'http://127.0.0.1:8840';
const api = `${backend}/api/v1`;
const artifacts = path.join(root, '.integrated-qa');
const python = process.env.QA_PYTHON || path.join(root, '.p12_3_backend_venv/Scripts/python.exe');
const results = [];
const children = [];
let browser;
let currentScenario = 'startup';
let serverErrors = 0;
let pageErrors = 0;
let fixturePassword = '';

async function poll(fn, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { last = await fn(); if (last) return last; } catch { /* wait for asynchronous UI */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.fail(message);
}
function launch(command, args, env) {
  const process = spawn(command, args, { cwd: root, env: { ...globalThis.process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  process.stdout.on('data', chunk => { output += String(chunk); });
  process.stderr.on('data', chunk => { output += String(chunk); });
  children.push(process);
  return { process, stopped: () => process.exitCode !== null, output: () => output };
}
async function scenario(name, action) {
  currentScenario = name;
  const started = Date.now();
  await action();
  results.push({ name, pass: true, ms: Date.now() - started });
  console.log(`PASS ${name}`);
}
async function json(context, endpoint, method = 'GET', data, expected = 200) {
  assert.ok(endpoint.startsWith('/'), 'Only local relative API paths are accepted');
  const response = await context.request.fetch(api + endpoint, { method, data });
  assert.equal(response.status(), expected, `${method} local API: expected ${expected}, got ${response.status()}`);
  return expected === 204 ? null : response.json();
}
async function writeResponse(page, endpoint, method, action, expected) {
  const pending = page.waitForResponse(response => response.url().split('?')[0] === api + endpoint && response.request().method() === method).then(response => {
    assert.equal(response.status(), expected, `${method} browser form: expected ${expected}, got ${response.status()}`);
    return response.status();
  });
  await action();
  return pending;
}
async function loginUI(context, email, password) {
  const page = await context.newPage();
  page.on('pageerror', () => { pageErrors++; });
  page.on('response', response => { if (response.url().startsWith(api) && response.status() >= 500) serverErrors++; });
  await page.goto(`${frontend}/login`);
  await page.getByLabel('Имэйл эсвэл утасны дугаар', { exact: true }).fill(email);
  await page.getByLabel('Нууц үг', { exact: true }).fill(password);
  await writeResponse(page, '/auth/login', 'POST', () => page.getByRole('button', { name: 'Нэвтрэх', exact: true }).click(), 200);
  await poll(() => !page.url().includes('/login'), 'Login form did not complete navigation');
  return page;
}
async function shared(page, familyId, personId) {
  await page.goto(`${frontend}/tree?view=shared&family=${familyId}`);
  await page.getByRole('button', { name: 'Бүгдийг харах', exact: true }).click();
  await page.locator(`#tree-person-${personId}`).waitFor({ state: 'visible' });
}
async function propose(page, targetName, candidateId, kind = 'child') {
  await page.getByRole('button', { name: `${targetName} хүнтэй холбоо нэмэх`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (kind === 'spouse') await dialog.getByLabel('Хань', { exact: true }).check();
  await dialog.getByLabel('Миний гэр бүлийн хүн').selectOption(candidateId);
  if (kind === 'spouse') await dialog.getByLabel('Ханийн холбоо').selectOption('widowed');
  await dialog.getByRole('checkbox').check();
  const pending = page.waitForResponse(response => response.url().includes('/shared-ancestry-requests') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Хүсэлт илгээх', exact: true }).click();
  const response = await pending;
  assert.equal(response.status(), 201, 'Real request submission failed');
  await dialog.waitFor({ state: 'hidden' });
  const familyId = new URL(page.url()).searchParams.get('family');
  const rows = await json(page.context(), `/families/${familyId}/shared-ancestry-requests`);
  const saved = rows.find(row => row.person_id === candidateId && row.kind === kind && row.status === 'pending');
  assert.ok(saved, 'Submitted request was not persisted for its requester');
  return saved;
}
async function decide(page, personName, approve) {
  await page.goto(`${frontend}/admin/ancestry`);
  const review = page.locator('[aria-labelledby="ancestry-review-title"]');
  const row = review.locator('li').filter({ hasText: personName });
  await row.waitFor({ state: 'visible' });
  if (approve) await row.getByRole('button', { name: 'Шалгаж батлах', exact: true }).click();
  const pending = page.waitForResponse(response => response.url().includes('/decision') && response.request().method() === 'POST');
  await row.getByRole('button', { name: approve ? 'Баталгаажуулж батлах' : 'Татгалзах', exact: true }).click();
  assert.equal((await pending).status(), 200, 'Admin review form failed');
  await row.waitFor({ state: 'hidden' });
}

try {
  await fs.access('.next/BUILD_ID');
  await fs.mkdir(artifacts, { recursive: true });
  const startedAt = Date.now();
  const runId = randomUUID();
  const backendProcess = launch(python, ['backend/ops/qa_fixture_server.py'], { APP_ENV: 'test', GUULINGIINHAN_QA_RUN_ID: runId });
  const fixture = await poll(async () => {
    assert.ok(!backendProcess.stopped(), 'Disposable API stopped during startup');
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(artifacts, 'fixture.json'), 'utf8'));
      if (!manifest.disposableLocalFixture || manifest.runId !== runId || Date.parse(manifest.generatedAt) < startedAt) return false;
      return (await fetch(`${backend}/health`)).ok ? manifest : false;
    } catch { return false; }
  }, 'Disposable API failed to start', 30000);
  fixturePassword = fixture.password;
  assert.equal(fixture.baseUrl, api, 'Fixture points outside the isolated local API');
  const nextProcess = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '8841'], { NEXT_PUBLIC_API_BASE_URL: api });
  await poll(async () => {
    assert.ok(!nextProcess.stopped(), 'Disposable frontend stopped during startup');
    try { return (await fetch(`${frontend}/login`)).ok; } catch { return false; }
  }, 'Local Next frontend failed to start', 30000);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const contexts = {};
  for (const key of Object.keys(fixture.emails)) contexts[key] = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const { familyA, familyB } = fixture.familyIds;
  const people = fixture.personIds;
  let ownerPage, adminPage;
  const personNames = {};
  await scenario('real password login for owner and SUPER_ADMIN', async () => {
    ownerPage = await loginUI(contexts.familyAOwner, fixture.emails.familyAOwner, fixture.password);
    adminPage = await loginUI(contexts.superAdmin, fixture.emails.superAdmin, fixture.password);
    for (const [key, context] of Object.entries(contexts)) if (!['familyAOwner', 'superAdmin'].includes(key)) {
      await json(context, '/auth/login', 'POST', { identifier: fixture.emails[key], password: fixture.password });
    }
    for (const [key, id] of Object.entries({ rootFather: people.rootFather, dolgor: people.rootChildren.dolgor, nansalmaa: people.rootChildren.nansalmaa, child: people.familyADeceasedChildCandidate, spouse: people.familyASpouseCandidate })) {
      const profile = await json(contexts.familyAOwner, `/families/${familyA}/persons/${id}`);
      personNames[key] = [profile.last_name, profile.first_name, profile.middle_name].filter(Boolean).join(' ');
    }
  });
  await scenario('root couple, four branches and isolated personal tree', async () => {
    await shared(ownerPage, familyA, people.rootFather);
    await poll(async () => (await ownerPage.locator('[id^="tree-person-"]').count()) === 6, 'The six root people did not finish rendering');
    await ownerPage.getByRole('link', { name: 'Манай гэр бүл', exact: true }).click();
    await ownerPage.locator(`#tree-person-${people.familyAOwnerPerson}`).waitFor({ state: 'visible' });
    assert.equal(await ownerPage.locator(`[id="tree-person-${people.rootChildren.baavai}"]`).count(), 0, 'Unrelated root branch appeared in the personal tree');
    assert.equal(await ownerPage.locator(`[id="tree-person-${people.familyBPrivatePerson}"]`).count(), 0);
  });
  let childRequest;
  await scenario('child request stays pending; duplicate is blocked', async () => {
    await shared(ownerPage, familyA, people.rootFather);
    childRequest = await propose(ownerPage, personNames.dolgor, people.familyADeceasedChildCandidate);
    assert.equal(childRequest.status, 'pending');
    assert.equal(await ownerPage.locator(`#tree-person-${people.familyADeceasedChildCandidate}`).count(), 0);
    await json(contexts.familyAOwner, `/families/${familyA}/shared-ancestry-requests`, 'POST', { person_id: people.familyADeceasedChildCandidate, target_person_id: people.rootChildren.dolgor, kind: 'child', share_consent: true }, 409);
  });
  await scenario('SUPER_ADMIN approval updates the real tree and reuses canonical edge', async () => {
    await decide(adminPage, personNames.child, true);
    await shared(ownerPage, familyA, people.familyADeceasedChildCandidate);
    const all = await json(contexts.familyAOwner, `/families/${familyA}/tree?scope=all&node_limit=1000`);
    assert.equal(all.parent_child_relationships.filter(edge => edge.parent_id === people.rootChildren.dolgor && edge.child_id === people.familyADeceasedChildCandidate).length, 1);
  });
  await scenario('spouse rejection preserves person; retry and approval show spouse beside branch', async () => {
    await propose(ownerPage, personNames.nansalmaa, people.familyASpouseCandidate, 'spouse');
    await decide(adminPage, personNames.spouse, false);
    await shared(ownerPage, familyA, people.rootFather);
    assert.equal(await ownerPage.locator(`#tree-person-${people.familyASpouseCandidate}`).count(), 0);
    await json(contexts.familyAOwner, `/families/${familyA}/persons/${people.familyASpouseCandidate}`);
    await propose(ownerPage, personNames.nansalmaa, people.familyASpouseCandidate, 'spouse');
    await decide(adminPage, personNames.spouse, true);
    await shared(ownerPage, familyA, people.familyASpouseCandidate);
    const a = await ownerPage.locator(`#tree-person-${people.rootChildren.nansalmaa}`).boundingBox();
    const b = await ownerPage.locator(`#tree-person-${people.familyASpouseCandidate}`).boundingBox();
    assert.ok(Math.abs(a.y - b.y) < 5, 'Spouse is not beside the branch person');
  });
  await scenario('deceased relative requires no account; request can be withdrawn safely', async () => {
    await ownerPage.getByRole('button', { name: `${personNames.dolgor} хүнтэй холбоо нэмэх`, exact: true }).click();
    const dialog = ownerPage.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Нас барсан хүн бүртгэх', exact: true }).click();
    await dialog.getByLabel('Нэр', { exact: true }).fill('QA Withdrawal Ancestor');
    await dialog.getByLabel('Товч намтар', { exact: true }).fill('Disposable local QA record');
    await dialog.getByRole('checkbox').check();
    const pending = ownerPage.waitForResponse(response => response.url().includes('/shared-ancestry-requests') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Хүсэлт илгээх', exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 201);
    await dialog.waitFor({ state: 'hidden' });
    const row = (await json(contexts.familyAOwner, `/families/${familyA}/shared-ancestry-requests`)).find(item => item.person_name === 'QA Withdrawal Ancestor' && item.status === 'pending');
    assert.ok(row, 'Manually created deceased ancestor request was not persisted');
    const request = ownerPage.getByRole('region', { name: 'Миний холболтын хүсэлтүүд' }).locator('li').filter({ hasText: 'QA Withdrawal Ancestor' });
    await request.getByRole('button', { name: 'Хүсэлт цуцлах', exact: true }).click();
    await request.getByText('Хүсэлт цуцлагдсан', { exact: true }).waitFor({ state: 'visible' });
    await json(contexts.familyAOwner, `/families/${familyA}/persons/${row.person_id}`);
  });
  await scenario('reviewed detachment preserves canonical person and parent relationship', async () => {
    await ownerPage.locator(`#tree-person-${people.familyADeceasedChildCandidate}`).click();
    await ownerPage.getByRole('button', { name: 'Салгах хүсэлт', exact: true }).click();
    const dialog = ownerPage.getByRole('dialog');
    await dialog.getByRole('checkbox').check();
    const pending = ownerPage.waitForResponse(response => response.url().includes('/shared-ancestry-requests') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Хүсэлт илгээх', exact: true }).click();
    assert.equal((await pending).status(), 201);
    await decide(adminPage, personNames.child, true);
    await shared(ownerPage, familyA, people.rootFather);
    assert.equal(await ownerPage.locator(`#tree-person-${people.familyADeceasedChildCandidate}`).count(), 0);
    await json(contexts.familyAOwner, `/families/${familyA}/persons/${people.familyADeceasedChildCandidate}`);
    const all = await json(contexts.familyAOwner, `/families/${familyA}/tree?scope=all&node_limit=1000`);
    assert.ok(all.parent_child_relationships.some(edge => edge.child_id === people.familyADeceasedChildCandidate && edge.parent_id === people.rootChildren.dolgor));
  });
  await scenario('admin person edit survives reload; portrait upload/read/delete is secure', async () => {
    await adminPage.goto(`${frontend}/admin/ancestry`);
    await adminPage.getByRole('button', { name: personNames.rootFather, exact: true }).click();
    await adminPage.getByRole('button', { name: 'Мэдээлэл засах', exact: true }).click();
    const editor = adminPage.locator('#person-editor');
    await editor.getByLabel('Төрсөн газар', { exact: true }).fill('QA local place');
    await editor.getByLabel('Товч намтар', { exact: true }).fill('QA isolated biography');
    await editor.getByLabel('Харагдах хүрээ').selectOption('public');
    await writeResponse(adminPage, `/admin/families/${familyA}/people/${people.rootFather}`, 'PATCH', () => editor.getByRole('button', { name: 'Өөрчлөлт хадгалах', exact: true }).click(), 200);
    let profile = await json(contexts.familyAOwner, `/families/${familyA}/persons/${people.rootFather}`);
    assert.equal(profile.birth_place, 'QA local place');
    assert.equal(profile.short_description, 'QA isolated biography');
    await adminPage.reload();
    await adminPage.getByRole('button', { name: personNames.rootFather, exact: true }).click();
    await adminPage.getByRole('button', { name: 'Мэдээлэл засах', exact: true }).click();
    assert.equal(await editor.getByLabel('Төрсөн газар', { exact: true }).inputValue(), 'QA local place');
    await editor.getByLabel('Хөрөг сонгох', { exact: true }).setInputFiles(fixture.imagePath);
    await writeResponse(adminPage, `/admin/families/${familyA}/people/${people.rootFather}/profile-photo`, 'POST', () => editor.getByRole('button', { name: 'Зураг байршуулах', exact: true }).click(), 201);
    await shared(ownerPage, familyA, people.rootFather);
    await poll(async () => ownerPage.locator(`#tree-person-${people.rootFather} img`).evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)), 'Shared authorized portrait failed to render');
    const guest = await browser.newContext();
    const tree = await json(contexts.familyAOwner, '/shared-lineage');
    const photoUrl = tree.persons.find(p => p.id === people.rootFather).profile_photo_url;
    assert.equal((await guest.request.get(api + photoUrl)).status(), 401);
    await guest.close();
    adminPage.once('dialog', dialog => dialog.accept());
    await writeResponse(adminPage, `/admin/families/${familyA}/people/${people.rootFather}/profile-photo`, 'DELETE', () => editor.getByRole('button', { name: 'Зураг арилгах', exact: true }).click(), 204);
  });
  let memoryId, storyId, archiveId, photoId;
  await scenario('account photo form upload, reload and removal protect private bytes', async () => {
    await ownerPage.goto(`${frontend}/settings?family=${familyA}`);
    await ownerPage.getByLabel('Аккаунтын зураг', { exact: true }).setInputFiles(fixture.imagePath);
    await writeResponse(ownerPage, '/auth/me/photo', 'POST', () => ownerPage.getByRole('button', { name: 'Зураг хадгалах', exact: true }).click(), 201);
    await poll(async () => ownerPage.getByAltText('Аккаунтын профайл зураг', { exact: true }).evaluate(image => image.complete && image.naturalWidth > 0), 'Account photo failed to load');
    await ownerPage.reload();
    await ownerPage.getByAltText('Аккаунтын профайл зураг', { exact: true }).waitFor({ state: 'visible' });
    const guest = await browser.newContext();
    assert.equal((await guest.request.get(api + '/auth/me/photo')).status(), 401);
    await guest.close();
    await writeResponse(ownerPage, '/auth/me/photo', 'DELETE', () => ownerPage.getByRole('button', { name: 'Аккаунтын зураг хасах', exact: true }).click(), 204);
    assert.equal((await json(contexts.familyAOwner, '/auth/me')).profile_photo_url, null);
  });
  await scenario('memory form uploads a real image and renders its protected preview', async () => {
    await ownerPage.goto(`${frontend}/memories/new?family=${familyA}`);
    await ownerPage.getByLabel('Гарчиг *', { exact: true }).fill('QA Photo Memory');
    await ownerPage.getByLabel('Тайлбар', { exact: true }).fill('Local heritage memory');
    await ownerPage.locator('#memory-photos').setInputFiles(fixture.imagePath);
    const uploaded = ownerPage.waitForResponse(response => /\/memories\/[^/]+\/photos$/.test(response.url()) && response.request().method() === 'POST').then(async response => {
      assert.equal(response.status(), 201);
    });
    await writeResponse(ownerPage, `/families/${familyA}/memories`, 'POST', () => ownerPage.getByRole('button', { name: 'Дурсамж хадгалах', exact: true }).click(), 201);
    await uploaded;
    await ownerPage.waitForURL(url => /^\/memories\/[0-9a-f-]{36}$/.test(url.pathname));
    memoryId = new URL(ownerPage.url()).pathname.split('/').at(-1);
    assert.equal((await json(contexts.familyAOwner, `/families/${familyA}/memories/${memoryId}`)).title, 'QA Photo Memory');
    photoId = (await json(contexts.familyAOwner, `/families/${familyA}/memories/${memoryId}/photos`)).items[0].id;
    await poll(async () => ownerPage.locator('main img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)), 'Memory photo did not render');
    assert.equal((await contexts.familyBOwner.request.get(`${api}/families/${familyA}/photos/${photoId}/content?variant=thumbnail`)).status(), 403);
  });
  await scenario('story editor inserts authorized memory image and persists formatted text', async () => {
    await ownerPage.goto(`${frontend}/stories/new?family=${familyA}`);
    await ownerPage.getByLabel('Гарчиг *', { exact: true }).fill('QA Illustrated Story');
    await ownerPage.locator('#story-body').fill('## Local heritage\n\n**Verified** story text.');
    await ownerPage.getByRole('button', { name: '📷 Зураг', exact: true }).click();
    const picker = ownerPage.getByRole('region', { name: 'Дурсамжаас зураг сонгох' });
    await picker.locator('.story-photo-options button').first().click();
    await writeResponse(ownerPage, `/families/${familyA}/stories`, 'POST', () => ownerPage.getByRole('button', { name: 'Түүх хадгалах', exact: true }).click(), 201);
    await ownerPage.waitForURL(url => /^\/stories\/[0-9a-f-]{36}$/.test(url.pathname));
    storyId = new URL(ownerPage.url()).pathname.split('/').at(-1);
    const saved = await json(contexts.familyAOwner, `/families/${familyA}/stories/${storyId}`);
    assert.ok(saved.body.includes(`[[photo:${photoId}|`));
    await poll(async () => ownerPage.locator('main img').evaluateAll(images => images.some(image => image.complete && image.naturalWidth > 0)), 'Story image did not render');
  });
  await scenario('archive form persists a private document', async () => {
    await ownerPage.goto(`${frontend}/archives/new?family=${familyA}`);
    await ownerPage.getByLabel('Гарчиг *', { exact: true }).fill('QA Private Archive');
    await ownerPage.getByRole('textbox', { name: /^Тайлбар/ }).fill('Local private source document');
    await writeResponse(ownerPage, `/families/${familyA}/archives`, 'POST', () => ownerPage.getByRole('button', { name: 'Хадгалах', exact: true }).click(), 201);
    await ownerPage.waitForURL(url => /^\/archives\/[0-9a-f-]{36}$/.test(url.pathname));
    archiveId = new URL(ownerPage.url()).pathname.split('/').at(-1);
    assert.equal((await json(contexts.familyAOwner, `/families/${familyA}/archives/${archiveId}`)).title, 'QA Private Archive');
  });
  await scenario('public heritage sharing preserves private Person and media boundaries', async () => {
    const other = contexts.familyBOwner;
    for (const [kind, id] of [['stories', storyId], ['memories', memoryId], ['archives', archiveId]]) {
      assert.equal((await other.request.get(`${api}/families/${familyA}/${kind}/${id}`)).status(), 403);
    }
    let feed = await json(other, '/community/feed');
    assert.ok(!feed.items.some(item => [storyId, memoryId, archiveId].includes(item.id)));
    const story = await json(contexts.familyAOwner, `/families/${familyA}/stories/${storyId}`);
    await json(contexts.familyAOwner, `/families/${familyA}/stories/${storyId}`, 'PUT', { title: story.title, body: 'Public text without private photo', visibility: 'public', person_ids: [] });
    feed = await json(other, '/community/feed');
    assert.ok(feed.items.some(item => item.id === storyId));
    assert.ok(!feed.items.some(item => item.id === memoryId || item.id === archiveId));
    assert.equal((await other.request.get(`${api}/families/${familyA}/photos/${photoId}/content?variant=original`)).status(), 403);
    await json(contexts.familyAOwner, `/families/${familyA}/memories/${memoryId}`, 'PATCH', { title: 'QA Photo Memory', description: 'Public memory text', visibility: 'public', person_ids: [] });
    feed = await json(other, '/community/feed');
    const published = feed.items.find(item => item.id === memoryId);
    assert.ok(published);
    assert.equal(published.thumbnail_url, null, 'Untagged family thumbnail became public');
    assert.equal((await json(other, `/community/memory/${memoryId}`)).photos.length, 0, 'Untagged family image became public');
    await json(contexts.familyAOwner, `/families/${familyA}/photos/${photoId}/tags`, 'PUT', { person_ids: [people.rootFather] });
    const publicPhotoMemory = (await json(other, '/community/feed')).items.find(item => item.id === memoryId);
    assert.ok(publicPhotoMemory.thumbnail_url, 'Explicitly permitted adult thumbnail is missing');
    const publicMemoryDetail = await json(other, `/community/memory/${memoryId}`);
    assert.equal(publicMemoryDetail.photos.length, 1, 'Explicitly permitted adult photo is missing from public memory');
    const publicPhoto = await other.request.get(api + publicMemoryDetail.photos[0]);
    assert.equal(publicPhoto.status(), 200);
    assert.ok(publicPhoto.headers()['cache-control'].includes('no-store'));
    assert.equal((await other.request.get(`${api}/families/${familyA}/persons/${people.rootFather}`)).status(), 403);
  });
  await scenario('family/public fund selection persists and hides private funds cross-family', async () => {
    await ownerPage.goto(`${frontend}/activities?family=${familyA}`);
    await ownerPage.getByLabel('Сангийн нэр', { exact: true }).fill('QA Public Fund');
    await ownerPage.getByLabel('Зориулалт', { exact: true }).fill('Local QA purpose');
    await ownerPage.getByLabel('Данс эсвэл QR заавар', { exact: true }).fill('Test instructions; no real financial account');
    await ownerPage.getByLabel('Харагдах хүрээ').selectOption('public');
    await writeResponse(ownerPage, `/families/${familyA}/funds`, 'POST', () => ownerPage.getByRole('button', { name: 'Сан үүсгэх', exact: true }).click(), 201);
    const fund = (await json(contexts.familyAOwner, `/families/${familyA}/funds`)).find(item => item.title === 'QA Public Fund');
    assert.ok(fund, 'Public fund was not persisted by the form');
    assert.equal(fund.visibility, 'public');
    const privateFund = await json(contexts.familyAOwner, `/families/${familyA}/funds`, 'POST', { title: 'QA Private Fund', purpose: 'Only A', payment_instruction: 'Private fixture instructions', visibility: 'family' }, 201);
    const publicFunds = await json(contexts.familyBOwner, '/public/funds');
    assert.ok(publicFunds.some(row => row.id === fund.id));
    assert.ok(!publicFunds.some(row => row.id === privateFund.id));
  });
  await scenario('meeting form creates a gathering and registration can be cancelled', async () => {
    await ownerPage.getByRole('button', { name: /Уулзалт, арга хэмжээ/ }).click();
    await ownerPage.getByLabel('Нэр', { exact: true }).fill('QA Local Meeting');
    await ownerPage.getByLabel('Байршил', { exact: true }).fill('Local test venue');
    await writeResponse(ownerPage, `/families/${familyA}/events`, 'POST', () => ownerPage.getByRole('button', { name: 'Арга хэмжээ үүсгэх', exact: true }).click(), 201);
    const event = (await json(contexts.familyAOwner, `/families/${familyA}/events`)).find(row => row.title === 'QA Local Meeting');
    assert.ok(event, 'Meeting form did not persist');
    const card = ownerPage.locator('.activities-card').filter({ hasText: 'QA Local Meeting' });
    await writeResponse(ownerPage, `/families/${familyA}/events/${event.id}/registrations`, 'POST', () => card.getByRole('button', { name: 'Бүртгүүлэх', exact: true }).click(), 201);
    await writeResponse(ownerPage, `/families/${familyA}/events/${event.id}/registrations/me/cancel`, 'POST', () => card.getByRole('button', { name: 'Бүртгэл цуцлах', exact: true }).click(), 204);
    assert.equal((await json(contexts.familyAOwner, `/families/${familyA}/events/${event.id}/registrations/me`)).status, 'cancelled');
  });
  await scenario('admin announcement draft stays private; published bell appears for another account', async () => {
    await adminPage.goto(`${frontend}/admin`);
    await adminPage.getByRole('button', { name: 'Мэдэгдэл', exact: true }).click();
    await adminPage.getByLabel('Гарчиг', { exact: true }).fill('QA Published News');
    await adminPage.getByLabel('Агуулга', { exact: true }).fill('Local organization announcement');
    await adminPage.getByRole('checkbox', { name: 'Бүх гишүүнд нийтлэх', exact: true }).check();
    const pending = adminPage.waitForResponse(response => response.url().includes('/admin/announcements') && response.request().method() === 'POST');
    await adminPage.getByRole('button', { name: 'Нийтлэх', exact: true }).click();
    assert.equal((await pending).status(), 201);
    await json(contexts.superAdmin, '/admin/announcements', 'POST', { title: 'QA Secret Draft', body: 'Unpublished text', is_published: false }, 201);
    const announcements = await json(contexts.familyBOwner, '/announcements?limit=8');
    assert.ok(announcements.some(row => row.title === 'QA Published News'));
    assert.ok(!announcements.some(row => row.title === 'QA Secret Draft'));
    await ownerPage.reload();
    await ownerPage.getByRole('button', { name: /Мэдэгдэл, уншаагүй/ }).click();
    await ownerPage.getByText('QA Published News', { exact: true }).waitFor({ state: 'visible' });
    await ownerPage.keyboard.press('Escape');
  });
  await scenario('real authenticated role matrix denies unauthorized admin decisions and private writes', async () => {
    for (const key of ['globalAdmin', 'globalModerator', 'familyAOwner', 'familyAEditor', 'familyAMember', 'familyBOwner']) {
      await json(contexts[key], '/admin/shared-lineage/requests?status=pending', 'GET', undefined, 403);
    }
    await json(contexts.familyAMember, `/families/${familyA}/persons`, 'POST', { first_name: 'Blocked fixture' }, 403);
    await json(contexts.familyBOwner, `/families/${familyA}/persons`, 'POST', { first_name: 'Blocked outsider' }, 403);
    await json(contexts.familyAEditor, `/families/${familyA}/funds`, 'POST', { title: 'Blocked editor', purpose: 'x', payment_instruction: 'x' }, 403);
    await json(contexts.familyAMember, `/families/${familyA}/shared-ancestry-requests`, 'POST', { person_id: people.familyAOwnerPerson, target_person_id: people.rootChildren.dolgor, kind: 'child', share_consent: true }, 403);
  });
  await scenario('own living profile joins by consent and cannot be selected as a duplicate', async () => {
    await shared(ownerPage, familyA, people.rootFather);
    const ownProfile = await json(contexts.familyAOwner, `/families/${familyA}/persons/${people.familyAOwnerPerson}`);
    const ownName = [ownProfile.last_name, ownProfile.first_name, ownProfile.middle_name].filter(Boolean).join(' ');
    await propose(ownerPage, personNames.dolgor, people.familyAOwnerPerson);
    await decide(adminPage, ownName, true);
    await shared(ownerPage, familyA, people.familyAOwnerPerson);
    await ownerPage.getByRole('button', { name: `${personNames.dolgor} хүнтэй холбоо нэмэх`, exact: true }).click();
    const dialog = ownerPage.getByRole('dialog');
    await dialog.getByText(/Таны профайл үндсэн модонд аль хэдийн холбогдсон/).waitFor({ state: 'visible' });
    assert.equal(await dialog.locator(`option[value="${people.familyAOwnerPerson}"]`).count(), 0);
    await ownerPage.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
  });
  await scenario('responsive real-data routes and keyboard dialogs have no crash or overflow', async () => {
    for (const width of [320, 390, 768, 1440]) {
      await ownerPage.setViewportSize({ width, height: 1000 });
      for (const route of ['/tree?view=shared', '/tree?view=family', '/stories', '/memories', '/archives', '/activities', '/settings']) {
        const contentPath = route === '/tree?view=shared' ? '/shared-lineage'
          : route === '/tree?view=family' ? `/families/${familyA}/tree`
          : route === '/activities' ? `/families/${familyA}/funds`
          : route === '/settings' ? '/auth/me' : `/families/${familyA}${route}`;
        const loaded = ownerPage.waitForResponse(response => response.request().method() === 'GET' && response.url().split('?')[0] === api + contentPath && response.status() === 200).then(response => response.finished());
        await ownerPage.goto(frontend + route + (route.includes('?') ? '&' : '?') + 'family=' + familyA);
        await loaded;
        await ownerPage.getByRole('heading', { level: 1 }).waitFor({ state: 'visible' });
        await poll(async () => ownerPage.evaluate(() => !document.querySelector('[aria-busy="true"]') && !/[Аа]чаалж байна|[Аа]чааллаж байна|хуудсыг нээж байна/.test(document.body.innerText)), 'Real-data responsive page remained busy');
        assert.ok(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `Horizontal overflow: ${width} ${route}`);
        // Next's screen-reader route announcer is role=alert, including on a
        // successful initial load. Assert application alerts independently.
        assert.equal(await ownerPage.locator('[role="alert"]:not(#__next-route-announcer__)').count(), 0, `Application alert in responsive route: ${width} ${route}`);
      }
      await shared(ownerPage, familyA, people.rootFather);
      await ownerPage.screenshot({ path: path.join(artifacts, `real-api-tree-${width}.png`) });
    }
    assert.equal(pageErrors, 0, 'Uncaught browser JavaScript errors');
    assert.equal(serverErrors, 0, 'Unexpected real API 5xx responses');
  });
  await scenario('logout revokes the real authenticated session', async () => {
    await json(contexts.familyAOwner, '/auth/logout', 'POST', undefined, 204);
    assert.equal((await contexts.familyAOwner.request.get(api + '/auth/me')).status(), 401);
  });
} catch (error) {
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    if (await page.locator('[role="alert"]:not(#__next-route-announcer__)').count()) {
      await page.screenshot({ path: path.join(artifacts, 'failure.png') });
      console.error('Local QA visible alerts:', await page.locator('[role="alert"]:not(#__next-route-announcer__)').allTextContents());
    }
    if (await page.getByRole('dialog').count()) {
      await page.screenshot({ path: path.join(artifacts, 'failure.png') });
      console.error('Local QA dialog alerts:', await page.getByRole('alert').allTextContents());
      console.error('Local QA dialog selects:', await page.getByRole('dialog').locator('select').evaluateAll(selects => selects.map(select => ({ disabled: select.disabled, optionCount: select.options.length }))));
    }
  }
  const safe = value => fixturePassword ? value.replaceAll(fixturePassword, '[local test credential]') : value;
  const message = safe(error instanceof Error ? error.message : 'Unknown QA failure');
  results.push({ name: currentScenario, pass: false, error: message });
  console.error(`FAIL ${currentScenario}: ${message}`);
  if (error instanceof Error) console.error(safe(error.stack?.split('\n').slice(1, 6).join('\n') || ''));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  for (const process of children.reverse()) if (process.exitCode === null) process.kill();
  const report = { checked_at: new Date().toISOString(), scope: 'Disposable localhost Next frontend → real FastAPI HTTP → isolated SQLite/private storage. Synthetic local records only; no staging/production data or provider deliveries.', mock_api: false, scenarios: results, passed: results.filter(row => row.pass).length, total: results.length };
  await fs.writeFile('docs/INTEGRATED_BROWSER_QA.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, total: report.total, evidence: 'docs/INTEGRATED_BROWSER_QA.json' }));
}
