import { test, expect } from './fixtures.ts';
import { approvedExplainer, waitForJob, post } from '../helpers/app.ts';

test('an explainer shows its token usage and estimated cost, with a per-job breakdown', async ({ page, app }) => {
  const { id } = await approvedExplainer(app);
  const job = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  expect(job.status).toBe('succeeded');
  const { usage } = await app.json(`/api/explainers/${id}`);

  await page.goto(`/explainers/${id}`);
  const summary = page.locator('details.usage > summary');
  // Fake agent: 3 runs at $0.02, 1,500 tokens each; fake narration is free.
  await expect(summary).toHaveText(`Usage · ≈ $0.06 · ${(usage.totals.inputTokens + usage.totals.outputTokens).toLocaleString('en-US')} tokens`);
  await summary.click();
  const rows = page.locator('details.usage tbody tr');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Source report');
  await expect(rows.nth(1)).toContainText('Plan');
  await expect(rows.nth(2)).toContainText('Build video');
  await expect(rows.nth(2)).toContainText(`${usage.entries[2].ttsChars.toLocaleString('en-US')} chars`);
  await expect(page.locator('details.usage')).toContainText('estimate');
});
