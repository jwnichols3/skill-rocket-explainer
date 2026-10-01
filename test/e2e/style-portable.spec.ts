import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures.ts';
import { post } from '../helpers/app.ts';

test('export a style to a file, then import it from the Styles page', async ({ page, app }) => {
  const s = await app.json('/api/styles', post({ name: 'Neon Noir', description: 'neon blue/green, high contrast', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));

  await page.goto(`/styles/${s.id}`);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export' }).click()]);
  expect(download.suggestedFilename()).toBe('neon-noir.style.json');
  const file = await download.path();
  expect(JSON.parse(await readFile(file, 'utf8')).style.name).toBe('Neon Noir');

  await page.goto('/styles');
  await page.getByLabel('Import style').setInputFiles(file);
  // The copy opens; the name was taken here, so the import says so.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Neon Noir (imported)');
  await expect(page).not.toHaveURL(new RegExp(s.id));
  await expect(page.getByText('No rounds yet')).toBeVisible();

  await page.goto('/styles');
  await expect(page.locator('.card-title')).toHaveText(['Neon Noir (imported)', 'Neon Noir']);
});

test('a file that is not a style export is refused with the reason', async ({ page }) => {
  await page.goto('/styles');
  await page.getByLabel('Import style').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
  await expect(page.locator('#toast')).toContainText('not a style export');
  await expect(page).toHaveURL(/\/styles$/);
});
