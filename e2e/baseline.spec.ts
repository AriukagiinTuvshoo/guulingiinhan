import { expect, test } from '@playwright/test';

test('login form sends cross-origin CSRF token and handles invalid credentials', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#login-email').fill('missing@example.com');
  await page.locator('#login-password').fill('incorrect-password');
  const csrfResponse = page.waitForResponse((response) => response.url().endsWith('/auth/csrf'));
  const loginResponse = page.waitForResponse((response) => response.url().endsWith('/auth/login'));
  await page.locator('button[type="submit"]').click();
  const csrf = await csrfResponse;
  const login = await loginResponse;
  expect(csrf.status()).toBe(200);
  const csrfToken = (await csrf.allHeaders())['x-csrf-token'];
  expect(csrfToken).toMatch(/^v1\./);
  expect((await login.request().allHeaders())['x-csrf-token']).toBe(csrfToken);
  expect(login.status()).toBe(401);
  await expect(page.getByText('Нэвтрэх мэдээлэл буруу байна.')).toBeVisible();
});

test('admin audit page does not expose family data to an anonymous visitor', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Үйлдлийн бүртгэл' })).toBeVisible();
  await expect(page.locator('.admin-console [role="alert"]')).toContainText('Нэвтрэх шаардлагатай.');
  await expect(page.locator('.admin-console__audit li')).toHaveCount(0);
});

test('cross-origin token endpoint exposes header and rejects missing token', async ({ page }) => {
  await page.goto('/login');
  const result = await page.evaluate(async () => {
    const endpoint = 'http://localhost:8100/api/v1/auth';
    const csrf = await fetch(`${endpoint}/csrf`, { credentials: 'include' });
    const token = csrf.headers.get('X-CSRF-Token');
    const missing = await fetch(`${endpoint}/logout`, { method: 'POST', credentials: 'include' });
    const valid = await fetch(`${endpoint}/logout`, {
      method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': token ?? '' },
    });
    return { token, missing: missing.status, valid: valid.status };
  });
  expect(result.token).toMatch(/^v1\./);
  expect(result.missing).toBe(403);
  expect(result.valid).toBe(204);
});
