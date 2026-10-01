import { test, expect } from './fixtures.ts';
import { approvedExplainer, put, post, waitForJob } from '../helpers/app.ts';

const imgWidth = (page: import('@playwright/test').Page) => page.locator('.output-panel img.output-image').evaluate((i: HTMLImageElement) => i.getBoundingClientRect().width);

test('visual viewer: fit / actual size toggle on fake output', async ({ page, app }) => {
  const { id } = await approvedExplainer(app, 'visual');
  await page.goto(`/explainers/${id}`);
  await page.getByRole('button', { name: /^Build/ }).click();
  const img = page.locator('.output-panel img.output-image');
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(320);
  const zoom = page.getByRole('group', { name: 'Zoom' });
  await expect(zoom.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true');
  const fitted = await imgWidth(page);
  expect(fitted).toBeGreaterThan(320);
  await zoom.getByRole('button', { name: 'Actual size' }).click();
  await expect(zoom.getByRole('button', { name: 'Actual size' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => imgWidth(page)).toBe(320);
  await zoom.getByRole('button', { name: 'Fit' }).click();
  await expect.poll(() => imgWidth(page)).toBe(fitted);
});

test('visual viewer: html-visual output, actual size is the canvas, seek marks the panel', async ({ page, app }) => {
  await app.json('/api/settings', put({ providers: { renderer: { visual: 'html-visual' } } }));
  const { id } = await approvedExplainer(app, 'visual');
  await page.goto(`/explainers/${id}`);
  await page.getByRole('button', { name: /^Build/ }).click();
  const img = page.locator('.output-panel img.output-image');
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(3200);
  // The sidecar is not offered as a download; the PNG and HTML are.
  await expect(page.locator('.output-panel a.btn')).toHaveText(['visual.png', 'visual.html']);

  await page.getByRole('group', { name: 'Zoom' }).getByRole('button', { name: 'Actual size' }).click();
  await expect.poll(() => imgWidth(page)).toBe(1600);

  const mark = page.locator('.visual-mark');
  await expect(mark).toBeHidden();
  await page.locator('.scene-chip', { hasText: 's2' }).click();
  await expect(mark).toBeVisible();
  await expect(mark).toHaveAttribute('data-scene', 's2');
  await expect(mark).toContainText('s2');
  // The mark sits where the renderer measured panel s2 (canvas px == CSS px at actual size).
  const layout = await app.json(`/media/explainers/${id}/outputs/visual/rounds/1/visual.json`);
  const s2 = layout.panels.find((p: any) => p.id === 's2');
  const [m, c] = await Promise.all([mark.boundingBox(), page.locator('.visual-canvas').boundingBox()]);
  expect(Math.abs(m!.x - c!.x - s2.x)).toBeLessThan(2);
  expect(Math.abs(m!.y - c!.y - s2.y)).toBeLessThan(2);
  expect(Math.abs(m!.width - s2.width)).toBeLessThan(2);
  await page.locator('.scene-chip', { hasText: 's3' }).click();
  await expect(mark).toHaveAttribute('data-scene', 's3');

  // Comment on one panel and re-render: only that panel goes back to the agent.
  const panel = page.locator('.output-panel');
  await panel.getByLabel('Pin to', { exact: true }).selectOption('s2');
  await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('bigger boxes');
  await panel.getByRole('button', { name: 'Add comment' }).click();
  await panel.getByRole('button', { name: /re-render: 1 comment/i }).click();
  await expect(panel).toContainText('Round 2', { timeout: 30_000 });
  await expect(panel.locator('.rendered')).toHaveText('Re-rendered s2');
});

test('style loop: on-demand visual sample with html-visual, comment, re-render', async ({ page, app }) => {
  await app.json('/api/settings', put({ providers: { renderer: { visual: 'html-visual' } } }));
  const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  await page.goto(`/styles/${s.id}`);
  await page.getByRole('tab', { name: /Visual/ }).click();
  const img = page.locator('img.output-image');
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(3200);
  await expect(page.locator('.round.current')).toContainText('Round 2');
  await page.getByRole('textbox', { name: 'Comment' }).fill('more whitespace between panels');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.getByRole('button', { name: /re-render with 1 comment/i }).click();
  await expect(page.locator('.round.current')).toContainText('Round 3', { timeout: 30_000 });
  await expect(page.getByRole('tab', { name: 'Visual', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(img).toBeVisible();
});
