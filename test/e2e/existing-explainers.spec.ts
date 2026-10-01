import { test, expect } from './fixtures.ts';
import { approvedExplainer, waitForJob, post } from '../helpers/app.ts';

test('find a past explainer, reopen it, see its history, add an output type, delete it', async ({ page, app }) => {
  const { id } = await approvedExplainer(app);
  await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'more upbeat', sceneId: 's1' }));

  await page.goto('/explainers');
  const row = page.locator('.explainer-list tbody tr').first();
  await expect(row).toContainText('Fake explainer');
  await expect(row).toContainText('Neon');
  await expect(row).toContainText('video');
  await expect(row).toContainText('built');
  await row.getByRole('link', { name: 'Fake explainer' }).click();

  // Reopened with full state: the video round and its comment.
  await expect(page.locator('video.output')).toBeVisible();
  await expect(page.locator('.output-panel .comment')).toContainText('more upbeat');

  // History: sources, plan versions, rounds and comments.
  await page.getByText('History', { exact: true }).click();
  const history = page.locator('.history');
  await expect(history).toContainText('Queues buffer work');
  await expect(history).toContainText('Plan v1 · video · approved');
  await expect(history).toContainText('Video round 1');
  await expect(history).toContainText('more upbeat');

  // Add an output type: switch to Deck; the report is reused and a deck plan can be proposed.
  await page.getByRole('radio', { name: /Deck/ }).check();
  await expect(page.locator('.plan')).toContainText('Propose a plan');
  await expect(page.locator('.report .finding')).toHaveCount(1);

  // Delete.
  await page.getByRole('button', { name: 'Delete explainer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/explainers$/);
  await expect(page.getByText('No explainers yet.')).toBeVisible();
});
