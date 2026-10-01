import { test, expect } from './fixtures.ts';
import { approvedExplainer, waitForJob, post } from '../helpers/app.ts';

test('doc viewer: a style doc sample shows the sample PDF and its Markdown', async ({ page, app }) => {
  const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({ outputType: 'doc' }))).id);
  await page.goto(`/styles/${s.id}`);
  await expect(page.locator('iframe.doc-frame')).toHaveAttribute('src', /rounds\/2\/sample\.pdf$/, { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Markdown' }).click();
  await expect(page.locator('pre.doc-md')).toContainText('## Packets');
});

test('doc viewer: PDF/Markdown toggle, and section chips seek in both views', async ({ page, app }) => {
  const { id } = await approvedExplainer(app, 'doc');
  await page.goto(`/explainers/${id}`);
  await page.getByRole('button', { name: /^Build/ }).click();
  const panel = page.locator('.output-panel');
  const frame = panel.locator('iframe.doc-frame');
  await expect(frame).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByRole('link', { name: 'doc.pdf' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'doc.md' })).toBeVisible();

  // PDF view: a section chip reopens the PDF at that section's named destination.
  await panel.locator('.scene-chip', { hasText: 's2' }).click();
  await expect(frame).toHaveAttribute('src', /doc\.pdf#nameddest=s2$/);

  // Markdown view.
  await panel.getByRole('tab', { name: 'Markdown' }).click();
  await expect(panel.getByRole('tab', { name: 'Markdown' })).toHaveAttribute('aria-selected', 'true');
  const md = panel.locator('pre.doc-md');
  await expect(md).toBeVisible();
  await expect(frame).toBeHidden();
  await expect(md).toContainText('## Section two');
  await panel.locator('.scene-chip', { hasText: 's3' }).click();
  await expect(md.locator('.doc-md-heading.is-target')).toHaveText('## Section three');

  // Back to the PDF.
  await panel.getByRole('tab', { name: 'PDF' }).click();
  await expect(panel.locator('iframe.doc-frame')).toBeVisible();
  await expect(md).toBeHidden();
});
