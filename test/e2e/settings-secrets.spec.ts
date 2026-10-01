import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';

const KEY = 'sk_e2e_not_a_real_key_1234567890';

test('an ElevenLabs API key can be saved and cleared on Settings without ever being shown', async ({ page, app }) => {
  await page.goto('/settings');
  const panel = page.locator('.voice-providers');
  await expect(panel.getByRole('heading', { name: 'Voice providers' })).toBeVisible();
  const field = panel.locator('.field.secret[data-provider="elevenlabs"]');
  const input = page.getByLabel('ElevenLabs API key');
  await expect(input).toHaveAttribute('type', 'password');
  await expect(field.locator('.secret-status')).toHaveText('not set');

  await input.fill(KEY);
  await field.getByRole('button', { name: 'Save' }).click();
  await expect(field.locator('.secret-status')).toHaveText('set');
  await expect(input).toHaveValue('');

  await page.reload();
  await expect(field.locator('.secret-status')).toHaveText('set');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('type', 'password');
  expect(await page.content()).not.toContain(KEY);
  expect(await readFile(join(app.home, 'secrets.json'), 'utf8')).toContain(KEY);

  await field.getByRole('button', { name: 'Clear' }).click();
  await expect(field.locator('.secret-status')).toHaveText('not set');
  await page.reload();
  await expect(field.locator('.secret-status')).toHaveText('not set');
  expect(await readFile(join(app.home, 'secrets.json'), 'utf8')).not.toContain(KEY);
});

test('the default voice provider is chosen on Settings and persists', async ({ page }) => {
  await page.goto('/settings');
  const select = page.getByLabel('Default voice provider');
  await expect(select).toHaveValue('fake');
  await expect(select.locator('option')).toContainText(['Fake TTS (tests)', 'Amazon Polly', 'ElevenLabs']);
  await select.selectOption('elevenlabs');
  await expect(page.locator('dl.kv dd').nth(1)).toHaveText('elevenlabs');
  await page.reload();
  await expect(page.getByLabel('Default voice provider')).toHaveValue('elevenlabs');
});
