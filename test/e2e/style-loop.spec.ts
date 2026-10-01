import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';
import { waitForJob, post, type TestApp } from '../helpers/app.ts';

async function seedStyle(app: TestApp, name: string | null = null) {
  const s = await app.json('/api/styles', post({ name, description: 'neon blue/green, high contrast', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  return s.id as string;
}

test('comment pinned to a timestamp, switch model and voice, re-render, see the new round', async ({ page, app }) => {
  const id = await seedStyle(app);
  await page.goto(`/styles/${id}`);
  const video = page.locator('video.sample');
  await expect(video).toBeVisible();
  await video.evaluate((v: HTMLVideoElement) => new Promise((r) => { v.currentTime = 2.5; v.onseeked = r; }));

  await page.getByRole('textbox', { name: 'Comment' }).fill('contrast too low');
  await page.getByLabel(/pin to/i).check();
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('.comment').filter({ hasText: 'contrast too low' }).locator('.ts')).toHaveText('0:02.5');

  await page.getByRole('textbox', { name: 'Comment' }).fill('voice is wrong');
  await page.getByRole('button', { name: 'Add comment' }).click();
  await expect(page.locator('.comment')).toHaveCount(2);

  await page.getByLabel('Next round model').selectOption('claude-fable-5-1');
  await page.getByLabel('Next round voice').selectOption('fake-deep');
  await page.getByRole('button', { name: /re-render with 2 comments/i }).click();

  await expect(page.getByText(/round 2 of 2/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.round.current')).toContainText('Round 2');
  await expect(page.locator('.round-meta')).toContainText('claude-fable-5-1');
  await page.getByText('Style instructions (DESIGN.md)').click();
  await expect(page.locator('pre.doc')).toContainText('contrast too low');
});

test('browse round history and revert to an earlier round', async ({ page, app }) => {
  const id = await seedStyle(app);
  await app.json(`/api/styles/${id}/rounds/1/comments`, post({ text: 'make it purple' }));
  await waitForJob(app, (await app.json(`/api/styles/${id}/rerender`, post({}))).id);
  await page.goto(`/styles/${id}`);
  await expect(page.getByText(/round 2 of 2/i)).toBeVisible();

  const r1 = page.locator('.round').filter({ hasText: 'Round 1' });
  await r1.getByRole('button', { name: 'View' }).click();
  await expect(page.locator('video.sample')).toHaveAttribute('src', /rounds\/1\/sample\.mp4/);
  await expect(page.locator('.comment').filter({ hasText: 'make it purple' })).toBeVisible();
  await r1.getByRole('button', { name: 'Make current' }).click();
  await expect(page.getByText(/round 1 of 2/i)).toBeVisible();
  await expect(page.locator('.round.current')).toContainText('Round 1');
  await expect(page.locator('.round')).toHaveCount(2);
});

test('save an unnamed style with a suggested name', async ({ page, app }) => {
  const id = await seedStyle(app);
  await page.goto(`/styles/${id}`);
  await expect(page.getByRole('heading', { name: 'Untitled style' })).toBeVisible();
  await page.getByRole('button', { name: 'Suggest names' }).click();
  const chips = page.locator('.name-chip');
  await expect(chips).toHaveCount(3);
  const picked = (await chips.nth(1).textContent())!.trim();
  await chips.nth(1).click();
  await expect(page.getByLabel('Style name')).toHaveValue(picked);
  await page.getByRole('button', { name: 'Save style' }).click();
  await expect(page.getByRole('heading', { name: picked })).toBeVisible();
  await expect(page.locator('.page-head .badge.warn')).toHaveCount(0);
});

test('clone a style, then delete it with a warning when explainers use it', async ({ page, app }) => {
  const id = await seedStyle(app, 'Original');
  await page.goto(`/styles/${id}`);
  await page.getByRole('button', { name: 'Clone' }).click();
  await expect(page.getByRole('heading', { name: 'Original copy' })).toBeVisible();
  const cloneId = page.url().split('/').pop()!;
  expect(cloneId).not.toBe(id);

  const ex = join(app.home, 'explainers', 'ex_uses');
  await mkdir(ex, { recursive: true });
  await writeFile(join(ex, 'explainer.json'), JSON.stringify({ id: 'ex_uses', title: 'Quarterly options', styleId: cloneId }));

  await page.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Quarterly options');
  await dialog.getByRole('button', { name: 'Delete anyway' }).click();
  await expect(page).toHaveURL(/\/styles$/);
  await expect(page.getByText('Original copy')).toHaveCount(0);
  await expect(page.getByText('Original', { exact: true })).toBeVisible();
});
