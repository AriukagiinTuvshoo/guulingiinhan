import { expect, test, type Page } from '@playwright/test';

const tag = `R${Date.now().toString(36).slice(-5).toUpperCase()}`;

// All API traffic runs inside the page context (browser Origin + cookies + double-submit CSRF),
// which is the convention the other online specs use. Playwright's page.request has no Origin
// header, so the CSRF origin guard answers 403 for state-changing calls.
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('e2e-admin-owner@example.com');
  await page.locator('#login-password').fill('e2e-test-password-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
}

async function send(page: Page, path: string, method: string, body?: object) {
  const result = await page.evaluate(async ({ apiPath, apiMethod, payload }) => {
    const base = 'http://localhost:8100/api/v1';
    const csrf = await fetch(`${base}/auth/csrf`, { credentials: 'include' });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf.headers.get('X-CSRF-Token') ?? '',
    };
    const response = await fetch(`${base}${apiPath}`, {
      method: apiMethod,
      credentials: 'include',
      headers,
      body: apiMethod === 'DELETE' || payload === null ? undefined : JSON.stringify(payload),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { apiPath: path, apiMethod: method, payload: body ?? null });
  if (result.status >= 400) throw new Error(`${method} ${path} -> ${result.status} ${JSON.stringify(result.body).slice(0, 200)}`);
  return result.body as Record<string, never>;
}

async function familyId(page: Page, name: string) {
  const id = await page.evaluate(async ({ familyName }) => {
    const families = await (await fetch('http://localhost:8100/api/v1/families', { credentials: 'include' })).json();
    return families.find((row: { name: string }) => row.name === familyName)?.id ?? null;
  }, { familyName: name });
  expect(id).toBeTruthy();
  return id as string;
}

test('family admin renames a person, links a marriage and assigns a lineage through the console', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const family = await familyId(page, 'E2E Family');
  const base = `/families/${family}`;
  const first = await send(page, `${base}/persons`, 'POST', { first_name: `WfFirst${tag}` });
  const second = await send(page, `${base}/persons`, 'POST', { first_name: `WfSecond${tag}` });
  const lineage = await send(page, `${base}/lineages`, 'POST', { name: `Lineage${tag}` });

  await page.goto(`/admin/people?family=${family}`);
  await page.getByLabel('Хүн хайх').fill(`WfFirst${tag}`);
  const row = page.locator('li').filter({ hasText: `WfFirst${tag}` });
  await expect(row).toBeVisible();

  // Rename through the console form; the paged directory must reflect the API write.
  await row.getByRole('button', { name: 'Засах' }).click();
  const editor = page.getByRole('form', { name: 'Профайл засах' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Нэр', { exact: true }).fill(`WfRenamed${tag}`);
  await editor.getByLabel('Овог', { exact: true }).fill(`Fam${tag}`);
  await editor.getByLabel('Хүйс').selectOption('male');
  await editor.getByRole('button', { name: 'Хадгалах' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Профайл шинэчлэгдлээ' })).toBeVisible();
  await page.getByLabel('Хүн хайх').fill(`WfRenamed${tag}`);
  const renamed = page.locator('li').filter({ hasText: `Fam${tag} WfRenamed${tag}` });
  await expect(renamed).toBeVisible();

  // The pickers are fed by the current directory page, so clear the search filter first.
  await page.getByLabel('Хүн хайх').fill('');
  await expect(page.locator('li').filter({ hasText: `WfSecond${tag}` })).toBeVisible();

  // Marriage edge: create it, then move it out of the active state.
  const marriageForm = page.getByRole('form', { name: 'Гэрлэлт холбох' });
  await marriageForm.getByLabel('Нэгдүгээр хүн').selectOption({ value: first.id });
  await marriageForm.getByLabel('Хоёрдугаар хүн').selectOption({ value: second.id });
  await marriageForm.getByLabel('Гэрлэсэн огноо').fill('1975-06-01');
  await marriageForm.getByRole('button', { name: 'Гэрлэлт хадгалах' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Гэрлэлтийн холбоо хадгалагдлаа' })).toBeVisible();
  const pair = page.locator('li').filter({ hasText: `WfRenamed${tag}` }).filter({ hasText: `WfSecond${tag}` });
  await expect(pair.getByText('Идэвхтэй')).toBeVisible();
  await pair.getByRole('button', { name: 'Төлөв цуцлах' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Гэрлэлтийн төлөв шинэчлэгдлээ' })).toBeVisible();
  await expect(pair.getByText('Цуцалсан')).toBeVisible();
  await expect(pair.getByRole('button', { name: 'Төлөв цуцлах' })).toHaveCount(0);

  // Lineage assignment shows up in the same directory row the console lists.
  const assign = page.getByRole('form', { name: 'Удам угсаанд оноох' });
  await assign.getByLabel('Хүн').selectOption({ value: first.id });
  await assign.getByLabel('Удам угсаа').selectOption({ value: lineage.id });
  await assign.getByRole('button', { name: 'Оноох' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Удам угсааны оноолт хадгалагдлаа' })).toBeVisible();
  await page.getByLabel('Хүн хайх').fill(`WfRenamed${tag}`);
  await expect(page.locator('li').filter({ hasText: `WfRenamed${tag} · Lineage${tag}` })).toBeVisible();
});

test('household connects and disconnects a clan link without exposing the other family', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  const household = await familyId(page, 'E2E Family');
  let clan = await page.evaluate(async () => {
    const families = await (await fetch('http://localhost:8100/api/v1/families', { credentials: 'include' })).json();
    return families.find((row: { name: string }) => row.name === 'E2E Clan')?.id ?? null;
  });
  if (!clan) clan = (await send(page, '/families', 'POST', { name: 'E2E Clan' })).id;
  await send(page, `/families/${household}/persons`, 'POST', { first_name: `BridgeMember${tag}` });
  await send(page, `/families/${clan}/persons`, 'POST', { first_name: `BridgeAnchor${tag}` });

  await page.goto(`/families/clan?family=${household}`);
  await expect(page.getByRole('heading', { name: 'Их үетэй холбох' })).toBeVisible();
  const clanSelect = page.getByLabel('Их үе (зөвхөн таны гишүүн гэр бүлүүд)');
  // The options only appear after the client fetch settles, which also proves hydration is
  // finished; this route is statically prerendered, so pre-hydration input is discarded.
  await expect(clanSelect.locator('option', { hasText: 'E2E Clan' })).toBeAttached();

  await clanSelect.selectOption({ value: clan });
  await expect(clanSelect).toHaveValue(clan);

  const householdPicker = page.locator('div.card', { has: page.getByLabel('Өрхийн хүн-ийг хайх') });
  const householdSearch = householdPicker.getByLabel('Өрхийн хүн-ийг хайх');
  await householdSearch.fill(`BridgeMember${tag}`);
  await expect(householdSearch).toHaveValue(`BridgeMember${tag}`);
  await householdPicker.getByRole('button', { name: 'Хайх' }).click();
  await householdPicker.getByRole('button', { name: new RegExp(`BridgeMember${tag}`) }).click();
  await expect(householdPicker.getByText(`Сонгосон: BridgeMember${tag}`)).toBeVisible();

  const clanPicker = page.locator('div.card', { has: page.getByLabel('Их үеийн хүн-ийг хайх') });
  const clanSearch = clanPicker.getByLabel('Их үеийн хүн-ийг хайх');
  await clanSearch.fill(`BridgeAnchor${tag}`);
  await expect(clanSearch).toHaveValue(`BridgeAnchor${tag}`);
  await clanPicker.getByRole('button', { name: 'Хайх' }).click();
  await clanPicker.getByRole('button', { name: new RegExp(`BridgeAnchor${tag}`) }).click();
  await expect(clanPicker.getByText(`Сонгосон: BridgeAnchor${tag}`)).toBeVisible();

  await page.getByRole('button', { name: 'Холбоос хадгалах' }).click();
  await expect(page.getByText('Холбоос хадгалагдлаа')).toBeVisible();
  const card = page.locator('div.card').filter({ hasText: 'Одоогийн холбоос' });
  await expect(card.getByText('Их үе: E2E Clan')).toBeVisible();
  await expect(card.getByText('Их үеийн тал: BridgeAnchor')).toBeVisible();
  await expect(page.locator('aside').getByText(`BridgeMember${tag}`)).toHaveCount(0);

  await card.getByRole('button', { name: 'Холбоос таслах' }).click();
  await expect(page.getByText('Холбоосыг тасаллаа.')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('trash console reaches records past its first page without duplicates', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  const family = await familyId(page, 'E2E Family');
  const names: string[] = [];
  for (let index = 0; index < 27; index += 1) {
    const label = `Tr${tag}${String(index).padStart(2, '0')}`;
    const person = await send(page, `/families/${family}/persons`, 'POST', { first_name: label });
    await send(page, `/families/${family}/persons/${person.id}`, 'DELETE');
    names.push(label);
  }

  await page.goto(`/admin/trash?family=${family}`);
  const nav = page.getByRole('navigation', { name: 'Хогийн савны хуудас' });
  const rows = page.locator('li');
  // Row text also carries the timestamp and the restore button, so membership is checked on the
  // name cell (<strong>) while page size is checked on the row count.
  const nameCells = () => page.locator('li strong');
  await expect(rows).toHaveCount(25);
  const newest = names[names.length - 1];
  const oldest = names[0];
  const firstPage = (await nameCells().allInnerTexts()).map((text) => text.trim());
  expect(firstPage).toContain(newest);
  expect(firstPage.join('\n')).not.toContain(oldest);

  const pages: string[][] = [firstPage];
  for (let index = 2; ; index += 1) {
    const next = nav.getByRole('button', { name: 'Дараах' });
    if (await next.isDisabled()) break;
    const before = pages[pages.length - 1].join('|');
    await next.click();
    await expect(nav).toContainText(`${index} / `);
    // The row set must actually change, otherwise the pager could be read mid-request.
    await expect.poll(async () => (await nameCells().allInnerTexts()).map((text) => text.trim()).join('|'))
      .not.toBe(before);
    const pageRows = (await nameCells().allInnerTexts()).map((text) => text.trim());
    expect(pageRows.length).toBeLessThanOrEqual(25);
    pages.push(pageRows);
  }
  expect(pages.length).toBeGreaterThanOrEqual(2);
  for (const pageRows of pages.slice(0, -1)) expect(pageRows).toHaveLength(25);
  const lastPage = pages[pages.length - 1].join('|');
  await nav.getByRole('button', { name: 'Өмнөх' }).click();
  await expect(rows).toHaveCount(25);
  await expect.poll(async () => (await nameCells().allInnerTexts()).map((text) => text.trim()).join('|'))
    .not.toBe(lastPage);
  const backToFirst = (await nameCells().allInnerTexts()).map((text) => text.trim());
  expect(backToFirst).toContain(newest);
  expect(backToFirst.join('\n')).not.toContain(oldest);
});
