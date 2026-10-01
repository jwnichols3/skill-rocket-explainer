import { test, expect } from './fixtures.ts';
import { waitForJob, post } from '../helpers/app.ts';

test('diagnostics page: checks, versions, job logs to read and download', async ({ page, app }) => {
  const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const job = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  await page.goto('/settings');
  await page.getByRole('link', { name: 'Diagnostics' }).click();
  await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible();
  await expect(page.locator('.check').filter({ has: page.locator('strong', { hasText: /^ffmpeg$/ }) }).locator('.badge')).toHaveText('ok');
  await expect(page.locator('.versions')).toContainText('Rocket Explainer');
  await expect(page.locator('.versions')).toContainText('Remotion');
  const row = page.locator('.job-row').filter({ hasText: 'style-sample' }).first();
  await row.getByRole('button', { name: 'View log' }).click();
  await expect(page.locator('pre.job-log-view')).toContainText('Designing the style');
  await expect(row.getByRole('link', { name: 'Download' })).toHaveAttribute('href', `/api/jobs/${job.id}/log`);
});
