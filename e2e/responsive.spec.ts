import { expect, test, type Page } from '@playwright/test';

// Scoped responsive smoke: the five screens that carry the online release must not
// overflow horizontally, and their primary content must be present, at phone, tablet
// and desktop widths. Checked on the built production bundle (E2E_SERVER=production).
const widths = [360, 390, 768, 1024, 1440] as const;

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill('e2e-admin-owner@example.com');
  await page.locator('#login-password').fill('e2e-test-password-123');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
}

async function familyId(page: Page) {
  const id = await page.evaluate(async () => {
    const families = await (await fetch('http://localhost:8100/api/v1/families', { credentials: 'include' })).json();
    return families.find((row: { name: string }) => row.name === 'E2E Family')?.id ?? null;
  });
  expect(id).toBeTruthy();
  return id as string;
}

// A container that scrolls by design is allowed; the document itself must not be wider
// than the viewport, otherwise phone users get a horizontal page scrollbar.
async function assertNoHorizontalOverflow(page: Page, label: string, width: number) {
  const metrics = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    viewport: window.innerWidth,
    wider: Array.from(document.querySelectorAll<HTMLElement>('main section, main .card, main form'))
      .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 3)
      .map((node) => `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 60)),
  }));
  expect(metrics.viewport, label).toBe(width);
  expect(metrics.document, `${label} document scrollWidth`).toBeLessThanOrEqual(width + 1);
  expect(metrics.body, `${label} body scrollWidth`).toBeLessThanOrEqual(width + 1);
  expect(metrics.wider, `${label} overflowing blocks`).toEqual([]);
}

// Negative control: proves the overflow assertion is not vacuously true. A deliberately
// too-wide block must be flagged by the same helper the screens are checked with.
test('the overflow detector flags a too-wide block', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('about:blank');
  await page.setContent('<main><section style="width:1200px;height:40px">wide</section></main>');
  let flagged = false;
  try {
    await assertNoHorizontalOverflow(page, 'negative control', 360);
  } catch {
    flagged = true;
  }
  expect(flagged, 'a 1200px block must fail the 360px check').toBe(true);
});

test('login screen is usable without horizontal overflow at every release width', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/login');
  await expect(page.getByRole('region', { name: 'ГУУЛИНГИЙНХАН нэвтрэх' })).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await assertNoHorizontalOverflow(page, `login ${width}px`, width);
    await expect(page.locator('#login-email')).toBeVisible();
  }
});

test('tree, families and clan screens stay inside the viewport at every release width', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const family = await familyId(page);
  const screens = [
    { label: 'tree', path: `/tree?family=${family}`, region: () => page.getByRole('region', { name: 'Удмын модны ажлын хэсэг' }) },
    { label: 'families', path: '/families', region: () => page.getByRole('heading', { name: 'Миний гэр бүлүүд' }) },
    { label: 'clan', path: `/families/clan?family=${family}`, region: () => page.getByRole('heading', { name: 'Их үетэй холбох' }) },
  ];
  for (const screen of screens) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(screen.path);
      await expect(screen.region().first(), `${screen.label} ${width}px content`).toBeVisible();
      await assertNoHorizontalOverflow(page, `${screen.label} ${width}px`, width);
    }
  }
});

test('admin hub, people and trash screens stay inside the viewport at every release width', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page);
  const family = await familyId(page);
  const screens = [
    { label: 'admin', path: `/admin?family=${family}`, region: () => page.getByRole('heading', { name: 'Удирдлага' }) },
    { label: 'admin-people', path: `/admin/people?family=${family}`, region: () => page.getByRole('form', { name: 'Гэрлэлт холбох' }) },
    { label: 'admin-trash', path: `/admin/trash?family=${family}`, region: () => page.getByRole('heading', { name: 'Хогийн сав' }) },
  ];
  for (const screen of screens) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(screen.path);
      await expect(screen.region().first(), `${screen.label} ${width}px content`).toBeVisible();
      await assertNoHorizontalOverflow(page, `${screen.label} ${width}px`, width);
    }
  }
  // The people console's form fields must remain reachable, not clipped, on the narrowest width.
  await page.setViewportSize({ width: 360, height: 900 });
  await page.goto(`/admin/people?family=${family}`);
  const editor = page.getByRole('form', { name: 'Профайл засах' });
  await expect(editor.getByLabel('Хүн')).toBeVisible();
  const box = await editor.getByLabel('Хүн').boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360 + 1);
});
