import { test, expect } from './fixtures.ts';

test('settings: choose the video renderer from the renderers that produce video', async ({ page, app }) => {
  await page.goto('/settings#rendering');
  const select = page.getByLabel('Video renderer');
  await expect(select).toHaveValue('fake');
  const options = await select.locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
  const { available } = await app.json('/api/settings');
  const video = available.renderer.filter((r: any) => r.outputTypes.includes('video')).map((r: any) => r.id);
  expect(options).toEqual(video);
  expect(options).toEqual(expect.arrayContaining(['fake', 'hyperframes']));

  await select.selectOption('hyperframes');
  await expect.poll(async () => (await app.json('/api/settings')).settings.providers.renderer.video).toBe('hyperframes');

  await page.reload();
  await expect(page.getByLabel('Video renderer')).toHaveValue('hyperframes');
});

test('settings: sections are tabs, and the tab is kept in the URL', async ({ page }) => {
  await page.goto('/settings');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveText(['Models & agents', 'Voices', 'Rendering', 'About']);
  await expect(page.getByRole('tab', { name: 'Models & agents' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Default model')).toBeVisible();
  await expect(page.getByLabel('Video renderer')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Providers' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Rendering' }).click();
  await expect(page).toHaveURL(/\/settings#rendering$/);
  await expect(page.getByLabel('Video renderer')).toBeVisible();
  await expect(page.getByLabel('Default model')).toBeHidden();
  await page.reload();
  await expect(page.getByLabel('Video renderer')).toBeVisible();

  await page.goto('/settings#voices');
  await expect(page.getByLabel('Default voice provider')).toBeVisible();
  await page.goto('/settings#about');
  await expect(page.getByRole('button', { name: 'Check for update' })).toBeVisible();

  // Phone width: no sideways scrolling.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/settings');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
