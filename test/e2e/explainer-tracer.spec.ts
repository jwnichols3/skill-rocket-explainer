import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';
import { post } from '../helpers/app.ts';

test('point at sources, read the report, steer, choose, plan, comment, approve', async ({ page, app }) => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-sources-'));
  await writeFile(join(dir, 'notes.md'), '# Options call');
  await writeFile(join(dir, 'later.md'), 'Option C');
  await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));

  await page.goto('/');
  await page.getByRole('main').getByRole('link', { name: /New explainer/ }).click();
  await page.getByLabel('What should it explain?').fill('the options discussed on this call');
  await page.getByLabel('Source 1', { exact: true }).fill(join(dir, 'no'));
  await expect(page.locator('#source-suggestions option')).toHaveAttribute('value', join(dir, 'notes.md'));
  await page.getByLabel('Source 1', { exact: true }).fill(join(dir, 'notes.md'));
  await page.getByRole('button', { name: 'Add source' }).click();
  await page.getByLabel('Source 2', { exact: true }).fill(join(dir, 'missing.md'));
  await page.getByRole('button', { name: 'Gather sources' }).click();

  // Source report: found / not found, expandable extract.
  await expect(page).toHaveURL(/\/explainers\/ex_/);
  const report = page.locator('.report');
  await expect(report.locator('.finding').filter({ hasText: 'notes.md' }).locator('.badge')).toHaveText('found', { timeout: 15_000 });
  await expect(report.locator('.finding').filter({ hasText: 'missing.md' }).locator('.badge')).toHaveText('not found');
  await report.locator('.finding').filter({ hasText: 'notes.md' }).getByText('What I extracted').click();
  await expect(report.getByText(/Key point from/)).toBeVisible();

  // Steer: drop the missing source, add one, correct a misreading, re-run.
  const saved = () => page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/api/explainers/'));
  await Promise.all([saved(), page.locator('.source-row').filter({ hasText: 'missing.md' }).getByRole('checkbox').uncheck()]);
  await expect(page.locator('.source-row')).toHaveCount(2);
  await page.getByLabel('Add a source').fill(join(dir, 'later.md'));
  await Promise.all([saved(), page.getByRole('button', { name: 'Add', exact: true }).click()]);
  await expect(page.locator('.source-row')).toHaveCount(3);
  await page.getByLabel('Correction').fill('Option B is Kafka');
  await page.getByRole('button', { name: 'Add correction' }).click();
  await page.getByRole('button', { name: 'Re-run report' }).click();
  await expect(report.locator('.overall')).toContainText('Option B is Kafka', { timeout: 15_000 });
  await expect(report.locator('.finding')).toHaveCount(2);

  // Choices.
  await page.getByLabel('Style', { exact: true }).selectOption({ label: 'Neon' });
  await page.getByRole('radio', { name: /Deck/ }).check();
  await page.getByLabel('Model', { exact: true }).selectOption('claude-fable-5-1');
  await page.getByLabel('Effort', { exact: true }).selectOption('max');

  // Plan, comment, revise, approve.
  await page.getByRole('button', { name: 'Propose a plan' }).click();
  const plan = page.locator('.plan');
  await expect(plan.locator('.plan-outline li')).toHaveCount(3, { timeout: 15_000 });
  await expect(plan.locator('.plan-scene')).toHaveCount(3);
  await expect(plan).toContainText('Slide one');
  await page.getByLabel('Comment on the plan').fill('lead with the cost comparison');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.getByRole('button', { name: /revise with 1 comment/i }).click();
  await expect(plan.getByText('Per comment: lead with the cost comparison')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Approve plan' }).click();
  await expect(page.locator('.plan .badge.ok')).toHaveText('approved');

  // Choices survived.
  const ex = await app.json(`/api/explainers/${page.url().split('/').pop()}`);
  expect([ex.outputType, ex.model, ex.effort, ex.approvedPlan]).toEqual(['deck', 'claude-fable-5-1', 'max', 2]);
});
