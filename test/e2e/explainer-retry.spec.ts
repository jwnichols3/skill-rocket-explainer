import { test, expect } from './fixtures.ts';
import { post, put, approvedExplainer, waitForJob } from '../helpers/app.ts';

test('a failed source report can be tried again from the explainer page', async ({ page, app }) => {
  await app.json('/api/settings', put({ fake: { failKinds: ['source-report'] } }));
  const e = await app.json('/api/explainers', post({ brief: 'how installing this skill works', sources: [{ value: 'https://example.com/readme' }] }));
  await waitForJob(app, (await app.json(`/api/explainers/${e.id}/report`, post({}))).id);

  await page.goto(`/explainers/${e.id}`);
  await expect(page.locator('.job .badge')).toHaveText('failed');
  await app.json('/api/settings', put({ fake: { failKinds: [] } }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.panel.report .overall')).toBeVisible({ timeout: 15_000 });
});

test('a failed build is tried again as a build of the same output type', async ({ page, app }) => {
  const { id } = await approvedExplainer(app);
  await app.json('/api/settings', put({ fake: { failKinds: ['explainer-script'] } }));
  await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);

  await page.goto(`/explainers/${id}`);
  await expect(page.locator('.job .badge')).toHaveText('failed');
  await app.json('/api/settings', put({ fake: { failKinds: [] } }));
  const retried = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/explainers/${id}/outputs/video/build`));
  await page.getByRole('button', { name: 'Try again' }).click();
  await retried;
  await expect(page.locator('.output-panel video')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.job .job-head')).toHaveCount(0);
});

test('an explainer with a brief but no sources can gather and re-run, and an empty report says what to add', async ({ page, app }) => {
  const e = await app.json('/api/explainers', post({ brief: 'how installing this skill works' }));
  await page.goto(`/explainers/${e.id}`);
  await page.getByRole('button', { name: 'Gather sources' }).click();
  const report = page.locator('.panel.report');
  await expect(report).toContainText('No sources were attached', { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Re-run report' })).toBeEnabled();
});
