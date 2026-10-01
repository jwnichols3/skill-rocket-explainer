import { test, expect } from './fixtures.ts';

test('previewing a voice on the new style page plays a short line', async ({ page }) => {
  await page.goto('/styles/new');
  await page.getByLabel('Voice', { exact: true }).selectOption('fake-bright');
  await page.getByRole('button', { name: /preview voice/i }).click();

  const audio = page.locator('audio.voice-preview');
  await expect(audio).toBeVisible();
  await expect(audio).toHaveAttribute('src', /\/media\/tts-preview\/[0-9a-f]+\.wav$/);
  // Playable: the browser loaded and decoded it.
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => (a.readyState >= 1 ? a.duration : 0)), { timeout: 10_000 }).toBeGreaterThan(1);
  await expect(page.locator('.voice-picker .callout.error')).toHaveCount(0);
});

test('a voice whose engine ignores pitch shows Pitch disabled with the reason', async ({ page }) => {
  await page.goto('/styles/new');
  await page.getByLabel('Voice', { exact: true }).selectOption('fake-deep');
  await expect(page.getByLabel('Pitch')).toBeDisabled();
  await expect(page.locator('.control.disabled', { has: page.getByLabel('Pitch') }).locator('.why')).toHaveText('This engine ignores pitch.');
  await expect(page.getByLabel('Rate')).toBeEnabled();

  await page.getByLabel('Voice', { exact: true }).selectOption('fake-bright');
  await expect(page.getByLabel('Pitch')).toBeEnabled();
});
