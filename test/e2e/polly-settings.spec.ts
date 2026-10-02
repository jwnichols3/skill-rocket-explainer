import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';

// The app runs in this worker: a fake ~/.aws with profiles but no usable credentials.
test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-polly-aws-'));
  await writeFile(join(dir, 'config'), '[profile narration]\nregion = eu-west-1\n\n[profile models]\nsso_session = corp\nregion = us-west-2\n');
  await writeFile(join(dir, 'credentials'), '');
  Object.assign(process.env, { AWS_CONFIG_FILE: join(dir, 'config'), AWS_SHARED_CREDENTIALS_FILE: join(dir, 'credentials'), AWS_EC2_METADATA_DISABLED: 'true' });
  for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete process.env[k];
});

test('Polly has its own AWS profile and region under Voices, separate from Bedrock', async ({ page, app }) => {
  await page.goto('/settings#voices');
  const panel = page.locator('.panel.polly');
  await expect(panel.getByRole('heading', { name: 'Amazon Polly' })).toBeVisible();
  await expect(panel).toContainText('separate from');

  await expect(panel.getByLabel('AWS profile for Polly').locator('option', { hasText: 'narration' })).toHaveCount(1);
  await panel.getByLabel('AWS profile for Polly').selectOption('narration');
  await panel.getByLabel('Polly region', { exact: true }).selectOption('eu-west-1');

  // Test tries the unsaved choice and says how to fix it.
  await panel.getByRole('button', { name: 'Test' }).click();
  await expect(panel.locator('.polly-status')).toContainText('region eu-west-1, profile narration');
  await expect(panel.locator('.polly-status')).toContainText('aws sso login --profile narration');
  expect((await app.json('/api/settings')).settings.polly.profile).toBeUndefined();

  await panel.getByRole('button', { name: 'Save Polly settings' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.polly).toEqual({ region: 'eu-west-1', profile: 'narration' });
  expect((await app.json('/api/settings')).settings.bedrock.profile).toBeUndefined();

  // The Bedrock profile lives elsewhere and says so.
  await page.goto('/settings#models');
  await expect(page.locator('.panel.agent-surfaces')).toContainText('Polly');
  await expect(page.getByLabel('AWS profile for Bedrock')).toHaveValue('');
});
