import { test, expect } from '@playwright/test';
import { startTestApp, approvedExplainer, waitForJob, post, type TestApp } from '../helpers/app.ts';

// The real deck renderer (html-deck) with the fake agent supplying slides: no model needed.
let app: TestApp;
test.beforeEach(async () => { app = await startTestApp({ providers: { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'html-deck', doc: 'fake', visual: 'fake' } } }); });
test.afterEach(async () => { await app.stop(); });

test('deck viewer: prev/next, scene chips seek, and in-deck keyboard navigation stays in sync', async ({ page }) => {
  const { id } = await approvedExplainer(app, 'deck');
  const job = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/deck/build`, post({}))).id);
  expect(job.status, job.error).toBe('succeeded');
  await page.goto(`${app.url}/explainers/${id}`);
  const panel = page.locator('.output-panel');
  const deck = page.frameLocator('.output-panel iframe.output-frame');
  const index = panel.locator('.deck-index');
  const active = deck.locator('section.slide.active');

  await expect(index).toContainText('Slide 1 / 3');
  await expect(active).toHaveAttribute('id', 's1');
  await expect(panel.getByRole('button', { name: 'Previous slide' })).toBeDisabled();
  await expect(panel.locator('a.btn')).toHaveText(['deck.html', 'deck.pptx']);

  await panel.getByRole('button', { name: 'Next slide' }).click();
  await expect(index).toContainText('Slide 2 / 3');
  await expect(active).toHaveAttribute('id', 's2');
  await panel.getByRole('button', { name: 'Previous slide' }).click();
  await expect(active).toHaveAttribute('id', 's1');

  await panel.locator('.scene-chip', { hasText: 's3' }).click();
  await expect(index).toContainText('Slide 3 / 3');
  await expect(active).toHaveAttribute('id', 's3');
  await expect(panel.getByRole('button', { name: 'Next slide' })).toBeDisabled();

  // Navigating inside the deck (click on the left third, then the keyboard) updates the viewer's index.
  await deck.locator('body').click({ position: { x: 10, y: 100 } });
  await expect(active).toHaveAttribute('id', 's2');
  await expect(index).toContainText('Slide 2 / 3');
  await page.keyboard.press('ArrowRight');
  await expect(active).toHaveAttribute('id', 's3');
  await expect(index).toContainText('Slide 3 / 3');
});
