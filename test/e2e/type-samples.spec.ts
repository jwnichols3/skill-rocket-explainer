import { test, expect } from './fixtures.ts';
import { approvedExplainer, waitForJob, post } from '../helpers/app.ts';

test('a style renders a deck sample on demand, then comments refine it', async ({ page, app }) => {
  const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  await page.goto(`/styles/${s.id}`);
  await page.getByRole('tab', { name: /Deck/ }).click();
  await expect(page.locator('iframe.output-frame')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('iframe.output-frame')).toHaveAttribute('src', /rounds\/2\/sample\.html/);
  await expect(page.getByRole('tab', { name: 'Deck', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.round.current')).toContainText('Round 2');
  await page.getByRole('textbox', { name: 'Comment' }).fill('bigger slide titles');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await page.getByRole('button', { name: /re-render with 1 comment/i }).click();
  await expect(page.locator('.round.current')).toContainText('Round 3', { timeout: 15_000 });
  await expect(page.getByRole('tab', { name: 'Deck', exact: true })).toHaveAttribute('aria-selected', 'true');
  // Back to the video sample.
  await page.getByRole('tab', { name: 'Video' }).click();
  await expect(page.locator('video.sample')).toBeVisible();
});

for (const [type, sel] of [['deck', 'iframe.output-frame'], ['doc', 'iframe.doc-frame'], ['visual', 'img.output-image']] as const) {
  test(`build a ${type}, view it, comment on a section, re-render`, async ({ page, app }) => {
    const { id } = await approvedExplainer(app, type);
    await page.goto(`/explainers/${id}`);
    await page.getByRole('button', { name: new RegExp(`^Build`) }).click();
    await expect(page.locator(`.output-panel ${sel}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.output-panel a.btn')).toHaveCount(2);
    const panel = page.locator('.output-panel');
    await panel.getByLabel('Pin to', { exact: true }).selectOption('s2');
    await panel.getByRole('textbox', { name: 'Comment', exact: true }).fill('tighter');
    await panel.getByRole('button', { name: 'Add comment' }).click();
    await panel.getByRole('button', { name: /re-render: 1 comment/i }).click();
    await expect(panel).toContainText('Round 2', { timeout: 15_000 });
  });
}
