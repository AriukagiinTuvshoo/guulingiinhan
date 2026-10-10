/** Atomic onboarding and membership QA: real local API, synthetic disposable data. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'C:/Users/enhtv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = process.cwd(), frontend = 'http://127.0.0.1:8841', backend = 'http://127.0.0.1:8840', api = `${backend}/api/v1`;
const artifacts = path.join(root, '.integrated-qa'), children = [], results = [], privateValues = [];
let browser, password = '', scenarioName = 'startup', pageErrors = 0, serverErrors = 0;
async function poll(fn, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch { /* asynchronous UI/data */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  assert.fail(message);
}
function launch(command, args, env) {
  const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  // Never print subprocess output: generated fixture credentials remain private.
  child.stdout.on('data', () => {}); child.stderr.on('data', () => {}); children.push(child); return child;
}
async function scenario(name, action) {
  scenarioName = name; const started = Date.now(); await action();
  results.push({ name, pass: true, ms: Date.now() - started }); console.log(`PASS ${name}`);
}
async function json(context, endpoint, method = 'GET', data, expected = 200) {
  assert.ok(endpoint.startsWith('/'), 'Only relative local API paths accepted');
  const response = await context.request.fetch(api + endpoint, { method, data });
  assert.equal(response.status(), expected, `Local ${method} ${endpoint}: unexpected HTTP status`);
  return expected === 204 ? null : response.json();
}
async function write(page, endpoint, method, action, expected) {
  const pending = page.waitForResponse(response => response.url().split('?')[0] === api + endpoint && response.request().method() === method);
  await action(); const response = await pending;
  assert.equal(response.status(), expected, 'Browser form did not complete expected real API operation');
  return response;
}
async function settled(page) {
  await poll(() => page.evaluate(() => !document.querySelector('[aria-busy="true"]') && !/[Аа]чаалж байна|[Аа]чааллаж байна|хуудсыг нээж байна/.test(document.body.innerText)), 'Page remained busy');
}
async function loginUI(context, identifier) {
  const page = await context.newPage();
  page.on('pageerror', () => { pageErrors++; });
  page.on('response', response => { if (response.url().startsWith(api) && response.status() >= 500) serverErrors++; });
  page.on('dialog', dialog => dialog.accept());
  await page.goto(frontend + '/login');
  await page.getByLabel('Имэйл эсвэл утасны дугаар', { exact: true }).fill(identifier);
  await page.getByLabel('Нууц үг', { exact: true }).fill(password);
  await write(page, '/auth/login', 'POST', () => page.getByRole('button', { name: 'Нэвтрэх', exact: true }).click(), 200);
  await poll(() => !page.url().includes('/login'), 'Login did not navigate'); return page;
}
async function mailboxToken(fixture, recipient) {
  const mailbox = path.resolve(fixture.mailboxPath);
  assert.ok(mailbox.startsWith(path.join(artifacts, 'runs') + path.sep), 'Fake mailbox escaped disposable fixture directory');
  const token = await poll(async () => {
    const rows = JSON.parse(await fs.readFile(mailbox, 'utf8'));
    const delivery = [...rows].reverse().find(row => row.recipient === recipient && row.text.includes('/invite#token='));
    return delivery ? new URL(delivery.text.split(' ').at(-1)).hash.slice(1).replace(/^token=/, '') : null;
  }, 'Actual fake invitation delivery was not recorded');
  privateValues.push(token); return token;
}
async function invite(ownerPage, family, recipient) {
  await ownerPage.goto(`${frontend}/invite?family=${family}`); await settled(ownerPage);
  await ownerPage.getByLabel('Урих имэйл', { exact: true }).fill(recipient);
  await ownerPage.getByLabel('Олгох эрх').selectOption('member');
  await write(ownerPage, `/families/${family}/invitations`, 'POST', () => ownerPage.getByRole('button', { name: 'Урилга илгээх', exact: true }).click(), 201);
  await ownerPage.getByRole('heading', { name: 'Урилга илгээгдлээ', exact: true }).waitFor({ state: 'visible' });
}
async function accept(page, token) {
  await page.goto(`${frontend}/invite#token=${encodeURIComponent(token)}`);
  await write(page, '/invitations/preview', 'POST', () => page.getByRole('button', { name: 'Урилгын гэр бүл, эрхийг шалгах', exact: true }).click(), 200);
  await write(page, '/invitations/accept', 'POST', () => page.getByRole('button', { name: 'Зөвшөөрч гэр бүлд нэгдэх', exact: true }).click(), 200);
  await page.getByRole('heading', { name: 'Гэр бүлд амжилттай нэгдлээ', exact: true }).waitFor({ state: 'visible' });
}

try {
  await fs.access('.next/BUILD_ID'); await fs.mkdir(artifacts, { recursive: true });
  const runId = randomUUID(), startedAt = Date.now();
  const fixtureServer = launch(process.env.QA_PYTHON || path.join(root, '.p12_3_backend_venv/Scripts/python.exe'), ['backend/ops/qa_fixture_server.py'], { APP_ENV: 'test', GUULINGIINHAN_QA_RUN_ID: runId });
  const fixture = await poll(async () => {
    assert.ok(fixtureServer.exitCode === null, 'Disposable backend stopped');
    const row = JSON.parse(await fs.readFile(path.join(artifacts, 'fixture.json'), 'utf8'));
    if (!row.disposableLocalFixture || row.runId !== runId || Date.parse(row.generatedAt) < startedAt) return false;
    return (await fetch(backend + '/health')).ok ? row : false;
  }, 'Fresh local API fixture unavailable', 30000);
  assert.equal(fixture.baseUrl, api); password = fixture.password;
  const next = launch(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '8841'], { NEXT_PUBLIC_API_BASE_URL: api });
  await poll(async () => next.exitCode === null && (await fetch(frontend + '/login')).ok, 'Local frontend unavailable', 30000);
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const contexts = {};
  for (const key of ['onboardingOwner', 'invitedFreshMember', 'invitedExistingMember', 'existingLinkedMember', 'superAdmin', 'familyBOwner']) contexts[key] = await browser.newContext({ viewport: { width: 390, height: 1000 } });
  const owner = await loginUI(contexts.onboardingOwner, fixture.emails.onboardingOwner);
  const member = await loginUI(contexts.invitedFreshMember, fixture.emails.invitedFreshMember);
  const claimant = await loginUI(contexts.invitedExistingMember, fixture.emails.invitedExistingMember);
  const existing = await loginUI(contexts.existingLinkedMember, fixture.emails.existingLinkedMember);
  const privateOwner = await loginUI(contexts.familyBOwner, fixture.emails.familyBOwner);
  await json(contexts.superAdmin, '/auth/login', 'POST', { identifier: fixture.emails.superAdmin, password });
  let family, ownPerson, submittedBody;

  await scenario('new account atomic browser onboarding creates one canonical linked person', async () => {
    await owner.goto(frontend + '/onboarding'); await settled(owner);
    await owner.getByLabel('Гэр бүлийн нэр', { exact: true }).fill('E2E onboarding family');
    await owner.getByLabel('Таны нэр', { exact: true }).fill('E2E Own Onboarding');
    const response = await write(owner, '/families/onboarding', 'POST', () => owner.getByRole('button', { name: 'Гэр бүлийн модоо эхлүүлэх', exact: true }).click(), 200);
    submittedBody = response.request().postDataJSON();
    const me = await json(contexts.onboardingOwner, '/auth/me'); ownPerson = me.person_id; assert.ok(ownPerson);
    const families = await json(contexts.onboardingOwner, '/families'); assert.equal(families.length, 1); family = families[0].id; assert.equal(families[0].role, 'owner');
    const workspace = await json(contexts.superAdmin, `/admin/families/${family}/workspace`);
    assert.equal(workspace.people.length, 1, 'Atomic self-setup created extra people');
    assert.equal(workspace.people[0].id, ownPerson);
    await owner.goto(`${frontend}/people?family=${family}`); await settled(owner);
    await owner.getByRole('link', { name: 'Миний профайлыг харах →', exact: true }).waitFor({ state: 'visible' });
  });
  await scenario('same-key and existing identity retries leave no orphan family/person', async () => {
    const beforeFamilies = await json(contexts.superAdmin, '/admin/families?limit=50');
    const beforeWorkspace = await json(contexts.superAdmin, `/admin/families/${family}/workspace`);
    const replay = await json(contexts.onboardingOwner, '/families/onboarding', 'POST', submittedBody);
    assert.equal(replay.family_id, family); assert.equal(replay.person_id, ownPerson);
    const existingIdentity = await json(contexts.onboardingOwner, '/families/onboarding', 'POST', { ...submittedBody, request_key: randomUUID(), family_name: 'Must never become an orphan' });
    assert.equal(existingIdentity.family_id, family); assert.equal(existingIdentity.person_id, ownPerson);
    assert.equal((await json(contexts.superAdmin, '/admin/families?limit=50')).length, beforeFamilies.length);
    assert.deepEqual((await json(contexts.superAdmin, `/admin/families/${family}/workspace`)).people.map(p => p.id), beforeWorkspace.people.map(p => p.id));
    await owner.goto(frontend + '/onboarding'); await settled(owner);
    assert.equal((await json(contexts.onboardingOwner, '/auth/me')).person_id, ownPerson);
  });
  await scenario('actual owner invitation email is accepted only by its verified recipient', async () => {
    await invite(owner, family, fixture.emails.invitedFreshMember);
    const token = await mailboxToken(fixture, fixture.emails.invitedFreshMember);
    await json(contexts.invitedExistingMember, '/invitations/accept', 'POST', { token }, 403);
    await accept(member, token);
    assert.equal((await json(contexts.invitedFreshMember, '/families')).find(row => row.id === family).role, 'member');
    assert.equal((await json(contexts.invitedFreshMember, '/auth/me')).person_id, null, 'Membership inferred a person identity');
    assert.equal((await json(contexts.invitedFreshMember, '/invitations/accept', 'POST', { token })).family_id, family);
  });
  await scenario('invited member creates only own canonical profile in the existing family', async () => {
    await member.goto(`${frontend}/people?family=${family}`); await settled(member);
    await member.getByRole('link', { name: 'Өөрийн мэдээллийг бүртгэх →', exact: true }).click(); await settled(member);
    await member.getByLabel('Таны нэр', { exact: true }).fill('E2E Invited Self');
    await write(member, '/families/onboarding', 'POST', () => member.getByRole('button', { name: 'Модондоо нэгдэх', exact: true }).click(), 200);
    const personId = (await json(contexts.invitedFreshMember, '/auth/me')).person_id; assert.ok(personId);
    assert.equal((await json(contexts.invitedFreshMember, '/families')).length, 1);
    await member.goto(`${frontend}/people?family=${family}`); await settled(member);
    await member.getByRole('link', { name: 'Миний профайлыг харах →', exact: true }).waitFor({ state: 'visible' });
    await json(contexts.invitedFreshMember, `/families/${family}/people`, 'GET', undefined, 403);
    await json(contexts.invitedFreshMember, `/families/${family}/persons/${ownPerson}`, 'PATCH', { first_name: 'Unauthorized rename' }, 403);
  });
  await scenario('existing canonical identity needs explicit reuse consent after invitation', async () => {
    const identity = (await json(contexts.existingLinkedMember, '/auth/me')).person_id; assert.ok(identity);
    await invite(owner, family, fixture.emails.existingLinkedMember);
    await accept(existing, await mailboxToken(fixture, fixture.emails.existingLinkedMember));
    const before = await json(contexts.superAdmin, `/admin/families/${family}/workspace`);
    await json(contexts.existingLinkedMember, '/families/onboarding', 'POST', { request_key: randomUUID(), family_id: family }, 409);
    assert.deepEqual((await json(contexts.superAdmin, `/admin/families/${family}/workspace`)).people.map(p => p.id), before.people.map(p => p.id));
    await existing.goto(`${frontend}/onboarding?family=${family}`); await settled(existing);
    await existing.getByRole('checkbox', { name: /Өөрийн удмын бүртгэлийг/ }).check();
    await write(existing, '/families/onboarding', 'POST', () => existing.getByRole('button', { name: 'Модондоо нэгдэх', exact: true }).click(), 200);
    assert.equal((await json(contexts.existingLinkedMember, '/auth/me')).person_id, identity);
    const after = await json(contexts.superAdmin, `/admin/families/${family}/workspace`);
    assert.equal(after.people.length, before.people.length + 1);
    assert.ok(after.people.some(person => person.id === identity));
    await invite(owner, family, fixture.emails.familyBOwner);
    await accept(privateOwner, await mailboxToken(fixture, fixture.emails.familyBOwner));
    const beforePrivate = await json(contexts.superAdmin, `/admin/families/${family}/workspace`);
    await json(contexts.familyBOwner, '/families/onboarding', 'POST', { request_key: randomUUID(), family_id: family, reuse_existing_person: true }, 403);
    assert.deepEqual((await json(contexts.superAdmin, `/admin/families/${family}/workspace`)).people.map(p => p.id), beforePrivate.people.map(p => p.id));
    await json(contexts.invitedFreshMember, `/families/${family}/persons/${fixture.personIds.familyBPrivatePerson}`, 'GET', undefined, 404);
  });
  await scenario('existing person claim waits for owner approval and persists after member reload', async () => {
    const canonical = await json(contexts.onboardingOwner, `/families/${family}/persons`, 'POST', { first_name: 'Existing Claimant', birth_date: '1980-01-01' }, 201);
    await invite(owner, family, fixture.emails.invitedExistingMember);
    await accept(claimant, await mailboxToken(fixture, fixture.emails.invitedExistingMember));
    await claimant.goto(`${frontend}/people?family=${family}`); await settled(claimant);
    await claimant.getByLabel('Миний бүртгэлийг нэрээр хайх', { exact: true }).fill('Existing');
    await claimant.getByLabel('Өөрийн бүртгэл').selectOption(canonical.id);
    await write(claimant, `/families/${family}/persons/${canonical.id}/link-request`, 'POST', () => claimant.getByRole('button', { name: 'Өөрийн бүртгэлтэй холбох хүсэлт', exact: true }).click(), 201);
    assert.equal((await json(contexts.invitedExistingMember, '/auth/me')).person_id, null);
    await claimant.reload(); await settled(claimant);
    await claimant.getByRole('button', { name: 'Зөвшөөрөл хүлээж байна', exact: true }).waitFor({ state: 'visible' });
    const requests = await json(contexts.onboardingOwner, `/families/${family}/link-requests`);
    const request = requests.find(row => row.person_id === canonical.id); assert.ok(request);
    await owner.goto(`${frontend}/people?family=${family}`); await settled(owner);
    await write(owner, `/families/${family}/link-requests/${request.id}/approve`, 'POST', () => owner.getByRole('button', { name: 'Шалгаж батлах', exact: true }).click(), 204);
    await claimant.reload(); await settled(claimant);
    assert.equal((await json(contexts.invitedExistingMember, '/auth/me')).person_id, canonical.id);
    await claimant.getByRole('link', { name: 'Миний профайлыг харах →', exact: true }).waitFor({ state: 'visible' });
  });
  await scenario('explicit parent relation has reciprocal tree views without ancestry inference', async () => {
    const parent = await json(contexts.onboardingOwner, `/families/${family}/persons/${fixture.personIds.existingLinkedPerson}`);
    await owner.goto(`${frontend}/tree?view=family&family=${family}&person=${ownPerson}`); await settled(owner);
    await owner.locator(`#tree-person-${ownPerson}`).press('Enter');
    await owner.getByRole('button', { name: '+ Эцэг/эх', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'Эцэг/эх нэмэх', exact: true });
    await dialog.getByRole('button', { name: 'Бүртгэлтэй хүн холбох', exact: true }).click();
    await dialog.getByLabel('Гэр бүлийн бүртгэлээс хайх', { exact: true }).fill('QA');
    const parentOption = dialog.getByRole('listbox', { name: 'Хайсан гэр бүлийн хүмүүс', exact: true }).getByRole('option').filter({ hasText: parent.first_name });
    await parentOption.click();
    await write(owner, `/families/${family}/relationships/parent-child`, 'POST', () => dialog.getByRole('button', { name: 'Холбоог хадгалах', exact: true }).click(), 201);
    await dialog.waitFor({ state: 'hidden' });
    const childTree = await json(contexts.onboardingOwner, `/families/${family}/tree?person_id=${ownPerson}&depth=2`);
    const parentTree = await json(contexts.onboardingOwner, `/families/${family}/tree?person_id=${parent.id}&depth=2`);
    for (const tree of [childTree, parentTree]) {
      assert.ok(tree.persons.some(person => person.id === ownPerson)); assert.ok(tree.persons.some(person => person.id === parent.id));
      assert.ok(tree.parent_child_relationships.some(edge => edge.parent_id === parent.id && edge.child_id === ownPerson));
    }
    await owner.locator(`#tree-person-${parent.id}`).waitFor({ state: 'visible' });
    await owner.screenshot({ path: path.join(artifacts, 'onboarding-parent-tree-390.png') });
  });
  await scenario('membership does not grant admin or cross-family private access', async () => {
    for (const context of [contexts.invitedFreshMember, contexts.invitedExistingMember]) {
      await json(context, '/admin/me', 'GET', undefined, 403);
      await json(context, `/families/${fixture.familyIds.familyB}/members`, 'GET', undefined, 403);
      await json(context, `/families/${fixture.familyIds.familyB}/persons/${fixture.personIds.familyBPrivatePerson}`, 'GET', undefined, 403);
      await json(context, `/families/${fixture.familyIds.familyB}/tree?scope=family`, 'GET', undefined, 403);
    }
    for (const page of [member, claimant]) {
      await page.goto(`${frontend}/people?family=${family}`); await settled(page);
      assert.equal(await page.getByRole('link', { name: /Админ удирдлага|Хүний удирдлага/ }).count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await page.screenshot({ path: path.join(artifacts, `onboarding-members-${page === member ? 'new' : 'existing'}-390.png`) });
    }
    assert.equal(pageErrors, 0, 'Browser JavaScript errors'); assert.equal(serverErrors, 0, 'Unexpected actual API 5xx');
  });
} catch (error) {
  let message = String(error?.message || error).replaceAll(password || '\0', '[local credential]');
  for (const token of privateValues) message = message.replaceAll(token, '[local invitation token]');
  results.push({ name: scenarioName, pass: false, error: message }); console.error(`FAIL ${scenarioName}: ${message}`); process.exitCode = 1;
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) await page.screenshot({ path: path.join(artifacts, `onboarding-failure-${index}.png`) }).catch(() => {});
} finally {
  if (browser) await browser.close(); for (const child of children.reverse()) if (child.exitCode === null) child.kill();
  const report = { checked_at: new Date().toISOString(), scope: 'Disposable synthetic localhost browser → actual FastAPI → SQLite. Actual fake-email invitation deliveries read only from ignored local mailbox. No request overrides, real emails or staging/production data.', mock_api: false, scenarios: results, passed: results.filter(row => row.pass).length, total: results.length };
  await fs.writeFile('docs/ONBOARDING_BROWSER_QA.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ passed: report.passed, total: report.total, evidence: 'docs/ONBOARDING_BROWSER_QA.json' }));
}
