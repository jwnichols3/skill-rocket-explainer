import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';
import { approvedExplainer, put } from '../helpers/app.ts';

test('build with visible progress, watch, comment on a scene, edit the script, re-render, export', async ({ page, app }) => {
  const { id } = await approvedExplainer(app);
  await app.json('/api/settings', put({ fake: { delayMs: 700 } }));
  await page.goto(`/explainers/${id}`);
  await page.getByRole('button', { name: 'Build video' }).click();

  // Progress: stage, current scene, elapsed.
  await expect(page.locator('.job-stage')).toHaveText('Writing the script');
  await expect(page.locator('.job-elapsed')).toHaveText(/\d/);
  await app.json('/api/settings', put({ fake: { delayMs: 0 } }));
  const video = page.locator('video.output');
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.job .job-head')).toHaveCount(0);

  // Scene timeline seeks.
  await page.locator('.scene-chip').nth(1).click();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.5);

  // Comment pinned to a scene.
  const panel = page.locator('.output-panel');
  await panel.getByLabel('Pin to', { exact: true }).selectOption('s2');
  await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('show the replay arrow');
  await panel.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('.output-panel .comment')).toContainText('show the replay arrow');

  // Script edit.
  await page.getByText('Narration script').click();
  await page.getByLabel('Narration for s1').fill('Two options. One decision. Zero regrets, hopefully.');
  await page.getByRole('button', { name: 'Save script' }).click();
  await expect(page.getByRole('button', { name: /re-render: 1 comment, 1 edited scene/i })).toBeVisible();
  await page.getByRole('button', { name: /re-render: 1 comment, 1 edited scene/i }).click();
  await expect(page.locator('.output-panel')).toContainText('Round 2', { timeout: 20_000 });
  await expect(page.locator('.output-panel .rendered')).toHaveText('Re-rendered s1, s2');

  // Export.
  const dir = await mkdtemp(join(tmpdir(), 'e2e-export-'));
  await page.getByLabel('Export to').fill(join(dir, 'final.mp4'));
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.locator('#toast')).toContainText('final.mp4');
  expect((await stat(join(dir, 'final.mp4'))).size).toBeGreaterThan(0);
});
