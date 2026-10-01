import { test, expect } from './fixtures.ts';

test('describe a new style, pick a voice, and watch the sample with sound', async ({ page }) => {
  await page.goto('/styles');
  await page.getByRole('link', { name: 'New style' }).click();

  await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
  await page.getByLabel(/decide later/i).check();
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await page.getByLabel('Describe the style').fill("Hitchhiker's Guide animations, smooth transitions, neon blue/green, high contrast, room for humor");
  await page.getByLabel('Voice provider').selectOption('fake');
  await page.getByLabel('Voice', { exact: true }).selectOption('fake-bright');
  await page.getByRole('button', { name: 'Render sample' }).click();

  // Lands on the style page with live job progress, then the sample.
  await expect(page).toHaveURL(/\/styles\/st_/);
  await expect(page.getByRole('heading', { name: 'Untitled style' })).toBeVisible();
  const video = page.locator('video.sample');
  await expect(video).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/round 1/i).first()).toBeVisible();

  // It plays, and the media has an audio track.
  await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play(); });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.2);
  const audio = await video.evaluate(async (v: HTMLVideoElement) => {
    await new Promise((r) => setTimeout(r, 400));
    return (v as any).webkitAudioDecodedByteCount as number;
  });
  expect(audio).toBeGreaterThan(0);
});

test('job progress survives a page reload', async ({ page, app }) => {
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ fake: { delayMs: 2500 } }) });
  await page.goto('/styles/new');
  await page.getByLabel('Name', { exact: true }).fill('Slow Burn');
  await page.getByLabel('Describe the style').fill('calm documentary');
  await page.getByRole('button', { name: 'Render sample' }).click();
  await expect(page.locator('.job-stage')).toHaveText('Designing the style');
  await page.reload();
  await expect(page.locator('.job-stage')).toHaveText('Designing the style');
  await expect(page.locator('video.sample')).toBeVisible({ timeout: 20_000 });
});

test('a failed sample shows the error and the log', async ({ page, app }) => {
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ fake: { failKinds: ['style-sample'] } }) });
  await page.goto('/styles/new');
  await page.getByLabel('Name', { exact: true }).fill('Doomed');
  await page.getByLabel('Describe the style').fill('anything');
  await page.getByRole('button', { name: 'Render sample' }).click();
  await expect(page.locator('.job .callout.error')).toContainText('fake failure for style-sample');
  await expect(page.getByRole('button', { name: /try again/i })).toBeVisible();
});
