import { expect, test, type Page } from '@playwright/test';

// Regression guard for the dashboard's memories contract.
//
// GET /families/{id}/memories answers with a page object
// ({ items, page, page_size, total, has_next }); the home screen must read `items` for
// the recent list and `total` for the family snapshot. When it treated the response as a
// bare array it threw `memoryData.slice is not a function`, the whole loadDashboard
// promise rejected, and a logged-in user was left with only the inline error alert.
//
// A green `<h1>` would not have caught that, so each test checks the endpoint contract,
// the rendered rows, the snapshot count, and the absence of any inline error alert.

const API_BASE = 'http://localhost:8100/api/v1';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('e2e-admin-owner@example.com');
  await page.locator('#login-password').fill('e2e-test-password-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
}

async function apiCall(page: Page, path: string, init: { method?: string; body?: string } = {}) {
  return page.evaluate(async ({ base, request }) => {
    const headers: Record<string, string> = {};
    if (request.method) {
      const csrf = await fetch(`${base}/auth/csrf`, { credentials: 'include' });
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = csrf.headers.get('X-CSRF-Token') ?? '';
    }
    const response = await fetch(`${base}${request.path}`, {
      method: request.method ?? 'GET',
      credentials: 'include',
      headers,
      body: request.body,
    });
    return { status: response.status, body: await response.json() };
  }, { base: API_BASE, request: { path, ...init } });
}

function memoriesPanel(page: Page) {
  return page.locator('.heritage-album-section').filter({ has: page.getByRole('heading', { name: 'Дахин дурсах мөчүүд' }) });
}

function snapshotCount(page: Page) {
  return page.locator('.heritage-stats a').filter({ hasText: 'Нандин дурсамж' }).locator('strong');
}

function memoryIndexRows(page: Page) {
  return page.locator('.heritage-memory-index a span');
}

test('dashboard reads the paginated memories contract instead of crashing', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));

  await login(page);
  const familyId: string | null = await page.evaluate(async (base) => {
    const families = await (await fetch(`${base}/families`, { credentials: 'include' })).json();
    return families.find((row: { name: string }) => row.name === 'E2E Family')?.id ?? null;
  }, API_BASE);
  expect(familyId, 'the seeded e2e family must exist').toBeTruthy();

  // Two memories of our own, so the assertions cannot be satisfied by leftover rows.
  const tag = `${Date.now().toString(36)}-${test.info().workerIndex}`;
  const titles = [`E2E Dashboard Memory ${tag} A`, `E2E Dashboard Memory ${tag} B`];
  for (const title of titles) {
    const created = await apiCall(page, `/families/${familyId}/memories`, {
      method: 'POST',
      body: JSON.stringify({ title, person_ids: [], visibility: 'family' }),
    });
    expect(created.status).toBe(201);
  }

  const payload = await apiCall(page, `/families/${familyId}/memories?page=1&page_size=6`);
  expect(payload.status).toBe(200);
  const page1 = payload.body;

  // 1. The endpoint really is paginated: the page object, never a bare array.
  expect(Array.isArray(page1), 'the memories endpoint must not answer with a bare array').toBe(false);
  expect(Object.keys(page1).sort()).toEqual(['has_next', 'items', 'page', 'page_size', 'total']);
  expect(page1.page).toBe(1);
  expect(page1.page_size).toBe(6);
  expect(Array.isArray(page1.items)).toBe(true);
  expect(page1.items.length).toBeLessThanOrEqual(6);
  expect(page1.total).toBeGreaterThanOrEqual(titles.length);
  const returnedTitles: string[] = page1.items.map((item: { title: string }) => item.title);
  for (const title of titles) {
    expect(returnedTitles, `page 1 must contain ${title}`).toContain(title);
  }

  const memoriesCall = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === `/api/v1/families/${familyId}/memories`;
  });
  await page.goto(`/dashboard?family=${familyId}`);
  const response = await memoriesCall;
  // 2. The dashboard asks for exactly the page it renders, and gets it.
  expect(response.status()).toBe(200);
  expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ page: '1', page_size: '6' });

  // 3. The rendered rows come from `items`, in the page's own order, capped at three.
  const panel = memoriesPanel(page);
  await expect(panel).toBeVisible();
  const renderedTitles = await memoryIndexRows(page).allTextContents();
  expect(renderedTitles).toEqual(page1.items.slice(0, 3).map((item: { title: string }) => item.title));
  expect(renderedTitles.length).toBeGreaterThan(0);
  if (page1.items.length <= 3) {
    for (const title of titles) {
      expect(renderedTitles, `the recent list must show ${title}`).toContain(title);
    }
  }

  // 4. The snapshot count is the visible total, not the length of one page.
  await expect(snapshotCount(page)).toHaveText(String(page1.total));

  // 5. The dashboard loaded: no inline error alert, no client-side exception.
  await expect(page.locator('main.heritage-dashboard')).toBeVisible();
  await expect(page.locator('.heritage-dashboard [role="alert"]'), 'the dashboard must not render an error alert').toHaveCount(0);
  expect(pageErrors, 'the dashboard must not throw while hydrating').toEqual([]);
});

test('dashboard shows the empty-memories state for a family without memories', async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));

  await login(page);
  const created = await apiCall(page, '/families', {
    method: 'POST',
    body: JSON.stringify({ name: `E2E Dashboard Empty ${Date.now().toString(36)}` }),
  });
  expect(created.status).toBe(201);
  const familyId: string = created.body.id;

  const emptyPage = await apiCall(page, `/families/${familyId}/memories?page=1&page_size=6`);
  expect(emptyPage.status).toBe(200);
  expect(emptyPage.body.items).toEqual([]);
  expect(emptyPage.body.total).toBe(0);
  expect(emptyPage.body.has_next).toBe(false);

  await page.goto(`/dashboard?family=${familyId}`);
  await expect(page.locator('main.heritage-dashboard')).toBeVisible();
  await expect(page.locator('.heritage-dashboard [role="alert"]'), 'an empty family must not error').toHaveCount(0);

  const panel = memoriesPanel(page);
  await expect(panel.getByText('Одоохондоо дурсамж нэмэгдээгүй байна.')).toBeVisible();
  await expect(memoryIndexRows(page)).toHaveCount(0);
  await expect(snapshotCount(page)).toHaveText('0');
  expect(pageErrors, 'the empty state must not throw').toEqual([]);
});
