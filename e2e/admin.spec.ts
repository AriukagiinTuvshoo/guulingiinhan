import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, who: 'owner' | 'delegate') {
  await page.goto('/login');
  await page.locator('#login-email').fill(`e2e-admin-${who}@example.com`);
  await page.locator('#login-password').fill('e2e-test-password-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
}

test('owner delegates trash access and delegate restores a detached person', async ({ page, context }) => {
  await login(page, 'owner');
  const data = await page.evaluate(async () => {
    const base = 'http://localhost:8100/api/v1';
    const families = await (await fetch(`${base}/families`, { credentials: 'include' })).json();
    const family = families.find((row: { name: string }) => row.name === 'E2E Family');
    const csrf = await fetch(`${base}/auth/csrf`, { credentials: 'include' });
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.headers.get('X-CSRF-Token') ?? '' };
    const created = await fetch(`${base}/families/${family.id}/persons`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ first_name: 'E2E Restorable' }) });
    const person = await created.json();
    const deleted = await fetch(`${base}/families/${family.id}/persons/${person.id}`, { method: 'DELETE', credentials: 'include', headers });
    const memory = await fetch(`${base}/families/${family.id}/memories`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ title: 'E2E Owner Memory', person_ids: [], visibility: 'family' }) });
    return { family: family.id, person: person.id, created: created.status, deleted: deleted.status, memory: (await memory.json()).id };
  });
  expect(data.created).toBe(201);
  expect(data.deleted).toBe(204);
  await page.goto(`/admin?family=${data.family}`);
  await expect(page.getByRole('heading', { name: 'Удирдлага' })).toBeVisible();
  await page.getByRole('link', { name: 'Админ эрх' }).click();
  const delegate = page.locator('fieldset').filter({ hasText: 'E2E delegate' });
  await delegate.getByLabel('Хогийн сав сэргээх').check();
  await delegate.getByLabel('Гэр бүлийн тохиргоо өөрчлөх').check();
  await delegate.getByLabel('Гишүүний урилга удирдах').check();
  await delegate.getByLabel('Хүмүүс удирдах').check();
  await delegate.getByLabel('Түүх болон архив удирдах').check();
  await delegate.getByRole('button', { name: 'Хадгалах' }).click();
  await expect(page.getByRole('status')).toContainText('Эрх хадгалагдлаа.');
  await context.clearCookies();
  await login(page, 'delegate');
  await page.goto(`/admin?family=${data.family}`);
  await expect(page.getByText('Үйлдлийн бүртгэл харах эрхгүй.')).toBeVisible();
  await page.getByRole('link', { name: 'Хүмүүс', exact: true }).click();
  await page.getByLabel('Нэр', { exact: true }).fill('E2E Delegate Person');
  await page.getByRole('button', { name: 'Хүн нэмэх' }).click();
  await expect(page.locator('li').filter({ hasText: 'E2E Delegate Person' })).toBeVisible();
  await page.getByLabel('Нэр', { exact: true }).fill('E2E Second Person');
  await page.getByRole('button', { name: 'Хүн нэмэх' }).click();
  await expect(page.locator('li').filter({ hasText: 'E2E Second Person' })).toBeVisible();
  const firstId = await page.getByLabel('Эцэг эсвэл эх').locator('option').filter({ hasText: 'E2E Delegate Person' }).getAttribute('value');
  const secondId = await page.getByLabel('Хүүхэд').locator('option').filter({ hasText: 'E2E Second Person' }).getAttribute('value');
  expect(firstId).toBeTruthy(); expect(secondId).toBeTruthy();
  await page.getByLabel('Эцэг эсвэл эх').selectOption(firstId!);
  await page.getByLabel('Хүүхэд').selectOption(secondId!);
  await page.getByRole('button', { name: 'Холбоо хадгалах' }).click();
  await expect(page.getByRole('status')).toContainText('холбоо хадгалагдлаа');
  await page.locator('select').filter({ has: page.locator(`option[value="${firstId}"]`) }).last().selectOption(firstId!);
  await expect(page.getByLabel('Намтар', { exact: true })).toBeEnabled();
  await page.getByLabel('Намтар', { exact: true }).fill('E2E biography');
  await page.getByRole('button', { name: 'Намтар хадгалах' }).click();
  await expect(page.getByRole('status')).toContainText('Намтар хадгалагдлаа');
  await page.getByRole('link', { name: 'Удирдлага руу буцах' }).click();
  await page.getByRole('link', { name: 'Агуулга', exact: true }).click();
  await page.getByLabel('Түүхийн гарчиг').fill('E2E Delegate Story');
  await page.getByLabel('Түүх', { exact: true }).fill('A delegated story.');
  await page.getByRole('button', { name: 'Түүх нэмэх' }).click();
  await expect(page.getByRole('link', { name: 'E2E Delegate Story' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Дурсамж' }).selectOption(data.memory);
  await page.getByLabel('Зураг', { exact: true }).setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP8z4AATAxEcQAz0QEHOoQ+uAAAAABJRU5ErkJggg==', 'base64') });
  await page.getByRole('button', { name: 'Зураг нэмэх' }).click();
  await expect(page.getByRole('status')).toContainText('Зураг хадгалагдлаа');
  await page.getByRole('link', { name: 'Удирдлага руу буцах' }).click();
  await page.getByRole('link', { name: 'Гишүүд ба урилга' }).click();
  await expect(page.getByRole('heading', { name: 'Гишүүд ба урилга' })).toBeVisible();
  await expect(page.getByText('E2E delegate')).toBeVisible();
  await expect(page.getByLabel('Гишүүний төрөл')).toHaveCount(0);
  const email = `e2e-invite-${Date.now()}@example.com`;
  await page.getByLabel('Имэйл').fill(email);
  await page.getByRole('button', { name: 'Урилга илгээх' }).click();
  await expect(page.getByText(email)).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.locator('li').filter({ hasText: email }).getByRole('button', { name: 'Цуцлах' }).click();
  await expect(page.getByText(email)).toHaveCount(0);
  await page.getByRole('link', { name: 'Удирдлага руу буцах' }).click();
  await page.getByRole('link', { name: 'Гэр бүлийн тохиргоо' }).click();
  await page.getByLabel('Тайлбар').fill('Updated by delegated administrator');
  await page.getByRole('button', { name: 'Хадгалах' }).click();
  await expect(page.getByRole('status')).toContainText('Тохиргоо хадгалагдлаа.');
  await page.getByRole('link', { name: 'Удирдлага руу буцах' }).click();
  await page.getByRole('link', { name: 'Хогийн сав' }).click();
  const row = page.locator('li').filter({ hasText: 'E2E Restorable' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Сэргээх' }).click();
  await expect(row).toHaveCount(0);
  const status = await page.evaluate(async ({ family, person }) => (await fetch(`http://localhost:8100/api/v1/families/${family}/persons/${person}`, { credentials: 'include' })).status, data);
  expect(status).toBe(200);
});

test('admin lists reach records beyond their first pages', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'owner');
  const family = await page.evaluate(async () => {
    const base = 'http://localhost:8100/api/v1';
    const families = await (await fetch(`${base}/families`, { credentials: 'include' })).json();
    const id = families.find((row: { name: string }) => row.name === 'E2E Family').id;
    const csrf = await fetch(`${base}/auth/csrf`, { credentials: 'include' });
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.headers.get('X-CSRF-Token') ?? '' };
    for (let i = 0; i < 51; i++) {
      const response = await fetch(`${base}/families/${id}/stories`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ title: `Pagination Story ${String(i).padStart(2, '0')}`, body: 'Pagination', person_ids: [], visibility: 'family' }) });
      if (!response.ok) throw new Error(`Story seed failed: ${response.status}`);
    }
    for (let i = 0; i < 26; i++) {
      const response = await fetch(`${base}/families/${id}/persons`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify({ first_name: `Pagination Person ${String(i).padStart(2, '0')}` }) });
      if (!response.ok) throw new Error(`Person seed failed: ${response.status}`);
    }
    return id as string;
  });
  await page.goto(`/admin/people?family=${family}`);
  await expect(page.getByRole('navigation', { name: 'Хүмүүсийн хуудас' })).toContainText('/ 2');
  await page.getByRole('navigation', { name: 'Хүмүүсийн хуудас' }).getByRole('button', { name: 'Дараах' }).click();
  await expect(page.locator('li').filter({ hasText: 'Pagination Person 25' })).toBeVisible();
  await page.goto(`/admin/content?family=${family}`);
  const stories = page.getByRole('navigation', { name: 'Түүхийн хуудас' });
  await expect(stories).toContainText('/ 3');
  await stories.getByRole('button', { name: 'Дараах' }).click();
  await stories.getByRole('button', { name: 'Дараах' }).click();
  await expect(stories).toContainText('3 / 3');
  await expect(page.getByRole('link', { name: 'Pagination Story 00' })).toBeVisible();
});
