import { expect, test } from '@playwright/test';

test('mobile member sees the family directory, tree and story after online mutations', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await page.locator('#login-email').fill('e2e-admin-owner@example.com');
  await page.locator('#login-password').fill('e2e-test-password-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
  const family = await page.evaluate(async () => {
    const base = 'http://localhost:8100/api/v1';
    const families = await (await fetch(`${base}/families`, { credentials: 'include' })).json();
    const id = families.find((item: { name: string }) => item.name === 'E2E Family').id;
    const csrf = await fetch(`${base}/auth/csrf`, { credentials: 'include' });
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.headers.get('X-CSRF-Token') ?? '' };
    async function send(path: string, method: string, body: object) {
      const response = await fetch(`${base}/families/${id}${path}`, { method, credentials: 'include', headers, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`${path} failed with ${response.status}`);
      return response.json();
    }
    const parent = await send('/persons', 'POST', { first_name: 'OnlineParent' });
    const child = await send('/persons', 'POST', { first_name: 'OnlineChild' });
    await send(`/persons/${parent.id}`, 'PATCH', { first_name: 'OnlineUpdated' });
    await send('/relationships/parent-child', 'POST', { parent_id: parent.id, child_id: child.id });
    await send('/stories', 'POST', { title: 'Online Family Story', body: 'A family story', person_ids: [], visibility: 'family' });
    return id as string;
  });
  await page.goto(`/people?family=${family}`);
  await page.getByLabel('Гэр бүлийн хүн хайх').fill('OnlineUpdated');
  await expect(page.getByRole('link', { name: /OnlineUpdated профайлыг нээх/ })).toBeVisible();
  await page.goto(`/tree?family=${family}`);
  await expect(page.getByRole('region', { name: 'Удмын модны ажлын хэсэг' })).toBeVisible();
  await page.getByLabel('Гэр бүлийн хүн хайх').fill('OnlineUpdated');
  await page.getByRole('region', { name: 'Хайлтын үр дүн' }).getByRole('button', { name: /OnlineUpdated/ }).click();
  await expect(page.getByRole('button', { name: 'OnlineUpdated хүнийг сонгох' })).toBeVisible();
  await page.goto(`/stories?family=${family}`);
  await expect(page.getByRole('heading', { name: 'Online Family Story' })).toBeVisible();
});
