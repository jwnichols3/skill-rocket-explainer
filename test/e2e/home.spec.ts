import { test, expect } from './fixtures.ts';

test('home page offers the four entry points, all empty on a fresh install', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rocket Explainer' })).toBeVisible();
  for (const name of ['New explainer', 'Existing explainers', 'Manage styles', 'Settings']) {
    await expect(page.getByRole('main').getByRole('link', { name: new RegExp(name) })).toBeVisible();
  }
  await page.getByRole('main').getByRole('link', { name: /Existing explainers/ }).click();
  await expect(page.getByText(/no explainers yet/i)).toBeVisible();
});
