import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';
import { post } from '../helpers/app.ts';
import { makeReferenceMedia } from '../helpers/media.ts';

let media: string;
test.beforeAll(async () => {
  media = await mkdtemp(join(tmpdir(), 'explainer-e2e-media-'));
  await makeReferenceMedia(media);
});
test.afterAll(async () => { await rm(media, { recursive: true, force: true }); });

async function startNewStyle(page: import('@playwright/test').Page, description: string) {
  await page.goto('/styles/new');
  await page.getByLabel(/decide later/i).check();
  await page.getByLabel('Describe the style').fill(description);
  await page.getByLabel('Voice provider').selectOption('fake');
}

test('suggest improvements while describing a style; insert one with a click', async ({ page }) => {
  await startNewStyle(page, 'retro computer explainer');
  await page.getByRole('button', { name: 'Suggest improvements' }).click();
  const rows = page.locator('.suggestion');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('palette');
  await rows.first().getByRole('button', { name: 'Insert' }).click();
  await expect(page.getByLabel('Describe the style')).toHaveValue('retro computer explainer\nBackground #0b0f14, titles #4fd1c5, one accent #f6e05e for highlights only.');
  await expect(rows).toHaveCount(3);
});

test('reference image and link attach on the new-style form and show on the style page', async ({ page }) => {
  await startNewStyle(page, 'calm documentary, warm paper tones');
  await page.getByLabel('Add reference image').setInputFiles(join(media, 'ref.png'));
  await page.getByLabel('Reference link').fill('https://example.com/look');
  await page.getByLabel('Link note').fill('the title cards');
  await page.getByRole('button', { name: 'Add link' }).click();
  await expect(page.locator('.ref-list .ref')).toHaveCount(2);
  await page.getByRole('button', { name: 'Render sample' }).click();

  await expect(page).toHaveURL(/\/styles\/st_/);
  await expect(page.locator('video.sample')).toBeVisible({ timeout: 20_000 });
  const panel = page.locator('.panel.references');
  await expect(panel.locator('img[alt="ref.png"]')).toBeVisible();
  await expect(panel.getByRole('link', { name: 'https://example.com/look' })).toBeVisible();
  await expect(panel).toContainText('the title cards');

  await panel.getByRole('button', { name: 'Remove https://example.com/look' }).click();
  await expect(panel.locator('.ref')).toHaveCount(1);
});

test('reference video on the new-style form: frames and instructions are visible before the first sample', async ({ page }) => {
  await startNewStyle(page, 'neon explainer');
  await page.getByLabel('Add reference video').setInputFiles(join(media, 'clip.mp4'));
  await page.getByRole('button', { name: 'Analyze reference video' }).click();

  await expect(page).toHaveURL(/\/styles\/st_/);
  const panel = page.locator('.panel.references');
  await expect(panel.locator('.ref-frames img').first()).toBeVisible({ timeout: 20_000 });
  await expect(panel.locator('.ref-instructions')).toContainText('near-black background');
  await expect(page.locator('.style-description')).toContainText('From the reference video "clip.mp4"');
  await expect(page.locator('pre.doc')).toContainText('neon cyan on near-black');
  await expect(page.locator('video.sample')).toHaveCount(0);

  await page.getByRole('button', { name: 'Render first sample' }).click();
  await expect(page.locator('video.sample')).toBeVisible({ timeout: 20_000 });
});

test('add a reference video to an existing style from its page; it is analyzed with progress', async ({ page, app }) => {
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ fake: { delayMs: 1500 } }) });
  const s = await app.json('/api/styles', post({ name: 'Plain', description: 'plain', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  await page.goto(`/styles/${s.id}`);
  await expect(page.getByRole('button', { name: 'Render first sample' })).toBeVisible();
  await page.getByLabel('Add reference video').setInputFiles(join(media, 'clip.mp4'));
  await expect(page.locator('.job-stage')).toHaveText('Reading the frames');
  await expect(page.getByText('Reading the reference video…')).toBeVisible();
  await expect(page.locator('.ref-instructions')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Analyze again' })).toBeEnabled();
});
