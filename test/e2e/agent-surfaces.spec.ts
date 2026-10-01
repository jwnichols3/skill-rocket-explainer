import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures.ts';
import { post } from '../helpers/app.ts';
import { discovery } from '../../src/providers/claude/bedrock.ts';

// The app runs in this worker: point AWS discovery at a fake ~/.aws and a canned Bedrock answer.
test.beforeAll(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'e2e-aws-'));
  await writeFile(join(dir, 'config'), '[default]\nregion = us-east-1\n\n[profile sandbox]\nsso_session = corp\nregion = us-west-2\n');
  await writeFile(join(dir, 'credentials'), '');
  process.env.AWS_CONFIG_FILE = join(dir, 'config');
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, 'credentials');
  discovery.inferenceProfiles = async () => [
    { id: 'us.amazon.nova-pro-v1:0', arn: '', name: 'Nova Pro', type: 'SYSTEM_DEFINED', anthropic: false },
    { id: 'us.anthropic.claude-opus-5-5', arn: '', name: 'US Opus 5.5', type: 'SYSTEM_DEFINED', anthropic: true },
    { id: 'us.anthropic.claude-fable-5-1', arn: '', name: 'US Fable 5.1', type: 'SYSTEM_DEFINED', anthropic: true },
  ];
});

test('settings: add, reorder and remove models, and pick the default model and effort', async ({ page, app }) => {
  await page.goto('/settings');
  const panel = page.locator('.panel.models');
  await expect(panel.locator('tr.model-row')).toHaveCount(2);
  await expect(page.getByLabel('Default model')).toHaveValue('claude-opus-5-5');
  await expect(page.getByLabel('Default effort')).toHaveValue('high');

  await panel.getByRole('button', { name: 'Add model' }).click();
  await panel.getByLabel('Model id 3').fill('claude-haiku-4-5');
  await panel.getByLabel('Model label 3').fill('Haiku 4.5');
  await panel.getByLabel('Model label 3').blur();
  await panel.getByRole('button', { name: 'Move Haiku 4.5 up' }).click();
  await page.getByLabel('Default model').selectOption('claude-haiku-4-5');
  await page.getByLabel('Default effort').selectOption('low');
  await panel.getByRole('button', { name: 'Save models' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.models.map((m: any) => m.id))
    .toEqual(['claude-opus-5-5', 'claude-haiku-4-5', 'claude-fable-5-1']);
  expect((await app.json('/api/settings')).settings.defaults).toEqual({ model: 'claude-haiku-4-5', effort: 'low' });

  // Removing the default moves the default to the first remaining model.
  await page.reload();
  await expect(page.getByLabel('Default model')).toHaveValue('claude-haiku-4-5');
  await panel.getByRole('button', { name: 'Remove Haiku 4.5' }).click();
  await expect(panel.locator('tr.model-row')).toHaveCount(2);
  await expect(page.getByLabel('Default model')).toHaveValue('claude-opus-5-5');
  await panel.getByRole('button', { name: 'Save models' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.models.map((m: any) => m.id)).toEqual(['claude-opus-5-5', 'claude-fable-5-1']);
  expect((await app.json('/api/settings')).settings.defaults.model).toBe('claude-opus-5-5');
});

test('settings: default agent surface, and Bedrock profile, region and discovered mapping', async ({ page, app }) => {
  await page.goto('/settings');
  await page.getByLabel('Default agent surface').selectOption('claude-bedrock');
  await expect.poll(async () => (await app.json('/api/settings')).settings.providers.agent).toBe('claude-bedrock');

  const panel = page.locator('.panel.agent-surfaces');
  await expect(page.getByLabel('AWS profile').locator('option')).toHaveText(['(default profile)', 'default · us-east-1', 'sandbox · us-west-2 · SSO']);
  await page.getByLabel('AWS profile').selectOption('sandbox');
  await page.getByLabel('Region').fill('us-west-2');
  await panel.getByRole('button', { name: 'Discover' }).click();
  await expect(panel.getByText(/Found 3 inference profiles \(2 Anthropic Claude\); filled 2 mappings/)).toBeVisible();
  await expect(page.getByLabel('Inference profile for Opus 5.5')).toHaveValue('us.anthropic.claude-opus-5-5');
  await panel.getByRole('button', { name: 'Save Bedrock settings' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.bedrock).toEqual({
    profile: 'sandbox', region: 'us-west-2', models: { 'claude-opus-5-5': 'us.anthropic.claude-opus-5-5', 'claude-fable-5-1': 'us.anthropic.claude-fable-5-1' },
  });
});

test('explainer: "Runs on" picks the agent surface for this explainer and persists', async ({ page, app }) => {
  const e = await app.json('/api/explainers', post({ brief: 'sensitive thing' }));
  await page.goto(`/explainers/${e.id}`);
  const runsOn = page.getByLabel('Runs on');
  await expect(runsOn).toHaveValue('fake');
  await expect(runsOn.locator('option')).toContainText(['Claude Code (subscription)', 'Claude Code on Amazon Bedrock']);
  await runsOn.selectOption('claude-bedrock');
  await expect.poll(async () => (await app.json(`/api/explainers/${e.id}`)).surface).toBe('claude-bedrock');
  await page.reload();
  await expect(page.getByLabel('Runs on')).toHaveValue('claude-bedrock');
});
