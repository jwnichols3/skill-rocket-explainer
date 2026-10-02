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

  // Ids are picked from the list; picking one names it.
  await panel.getByRole('button', { name: 'Add model' }).click();
  await panel.getByLabel('Model id 3', { exact: true }).selectOption('claude-haiku-4-5');
  await expect(panel.getByLabel('Model label 3')).toHaveValue('Haiku 4.5');
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

test('settings: model ids not in the list are typed under Other, and Refresh list adds what Bedrock offers', async ({ page, app }) => {
  discovery.foundationModels = async () => [{ id: 'anthropic.claude-mythos-6-v1:0', name: 'Claude Mythos 6', inferenceTypesSupported: ['ON_DEMAND'] }];
  await page.goto('/settings');
  const panel = page.locator('.panel.models');
  await expect(panel.getByText('built-in models. Refresh to add what Bedrock offers.')).toBeVisible();
  await expect(panel.getByLabel('Model id 1', { exact: true }).locator('option[value="claude-mythos-6"]')).toHaveCount(0);

  await panel.getByRole('button', { name: 'Refresh list' }).click();
  await expect(panel.getByText(/models \(1 on Bedrock\) · updated/)).toBeVisible();
  await panel.getByRole('button', { name: 'Add model' }).click();
  await panel.getByLabel('Model id 3', { exact: true }).selectOption('claude-mythos-6');
  await expect(panel.getByLabel('Model label 3')).toHaveValue('Mythos 6');

  await panel.getByRole('button', { name: 'Add model' }).click();
  await panel.getByLabel('Model id 4', { exact: true }).selectOption({ label: 'Other…' });
  await panel.getByLabel('Model id 4, other value').fill('claude-custom-1');
  await panel.getByLabel('Model label 4').fill('Custom');
  await panel.getByRole('button', { name: 'Save models' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.models.map((m: any) => m.id))
    .toEqual(['claude-opus-5-5', 'claude-fable-5-1', 'claude-mythos-6', 'claude-custom-1']);

  // After a reload, a saved id that isn't in the list still shows, as Other.
  await page.reload();
  await expect(panel.getByLabel('Model id 4', { exact: true })).toHaveValue('__other__');
  await expect(panel.getByLabel('Model id 4, other value')).toHaveValue('claude-custom-1');
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-fable-5-1', label: 'Fable 5.1' }] }) });
});

test('settings: default agent surface, and Bedrock profile, region and discovered mapping', async ({ page, app }) => {
  await page.goto('/settings');
  await page.getByLabel('Default agent surface').selectOption('claude-bedrock');
  await expect.poll(async () => (await app.json('/api/settings')).settings.providers.agent).toBe('claude-bedrock');

  const panel = page.locator('.panel.agent-surfaces');
  await expect(page.getByLabel('AWS profile for Bedrock').locator('option')).toHaveText(['(default profile)', 'default · us-east-1', 'sandbox · us-west-2 · SSO']);
  await page.getByLabel('AWS profile for Bedrock').selectOption('sandbox');
  await page.getByLabel('Region', { exact: true }).selectOption('us-west-2');
  await panel.getByRole('button', { name: 'Discover' }).click();
  // Routing defaults to Global; Bedrock offers only US profiles here, so both rows fall back.
  await expect(panel.getByText(/Found 3 inference profiles \(2 Anthropic Claude\); filled 2 mappings.*2 fell back to Geographic \(about 10% more\)/)).toBeVisible();
  await expect(page.getByLabel('Inference profile for Opus 5.5', { exact: true })).toHaveValue('us.anthropic.claude-opus-5-5');
  await panel.getByRole('button', { name: 'Save Bedrock settings' }).click();
  await expect.poll(async () => (await app.json('/api/settings')).settings.bedrock).toEqual({
    profile: 'sandbox', region: 'us-west-2', scope: 'global', models: { 'claude-opus-5-5': 'us.anthropic.claude-opus-5-5', 'claude-fable-5-1': 'us.anthropic.claude-fable-5-1' },
  });
});

test('settings: Bedrock routing scope drives Discover, badges each mapping, is saved, and has no Global in GovCloud', async ({ page, app }) => {
  const orig = discovery.inferenceProfiles;
  discovery.inferenceProfiles = async () => [
    { id: 'global.anthropic.claude-opus-5-5', arn: '', name: 'Global Opus 5.5', type: 'SYSTEM_DEFINED', anthropic: true },
    { id: 'us.anthropic.claude-opus-5-5', arn: '', name: 'US Opus 5.5', type: 'SYSTEM_DEFINED', anthropic: true },
    { id: 'us.anthropic.claude-fable-5-1', arn: '', name: 'US Fable 5.1', type: 'SYSTEM_DEFINED', anthropic: true },
  ];
  try {
    await page.goto('/settings#models');
    const panel = page.locator('.panel.agent-surfaces');
    const routing = panel.getByRole('group', { name: 'Routing' });
    const global = routing.getByRole('radio', { name: 'Global (recommended)' });
    const geo = routing.getByRole('radio', { name: 'Geographic' });
    const inRegion = routing.getByRole('radio', { name: 'In-region' });
    // The radio itself is visually hidden; people click its label.
    const pick = (name: string) => routing.getByText(name, { exact: true }).click();
    await expect(global).toBeChecked();
    await expect(panel.getByText('Processed in any AWS commercial region; about 10% cheaper than Geographic or In-region. Your AWS organisation must allow global requests (aws:RequestedRegion = unspecified).')).toBeVisible();
    await pick('In-region');
    await expect(panel.getByText('Runs only in this region; most current Claude models are not offered this way.')).toBeVisible();

    // An unmapped row shows no badge.
    const fableBadge = panel.locator('tr').filter({ has: page.getByText('claude-fable-5-1', { exact: true }) }).locator('.badge');
    await expect(fableBadge).toBeHidden();

    // Discover sends the unsaved choice.
    await pick('Geographic');
    await expect(panel.getByText('Stays within the geography of your region (US, EU, Japan or Australia).')).toBeVisible();
    await panel.getByRole('button', { name: 'Discover' }).click();
    await expect(panel.getByText(/filled 2 mappings/)).toBeVisible();
    await expect(panel.getByText(/fell back/)).toHaveCount(0);
    await expect(page.getByLabel('Inference profile for Opus 5.5', { exact: true })).toHaveValue('us.anthropic.claude-opus-5-5');
    const opusBadge = panel.locator('tr').filter({ has: page.getByText('claude-opus-5-5', { exact: true }) }).locator('.badge');
    await expect(opusBadge).toHaveText('geo');
    await expect(opusBadge).not.toHaveClass(/warn/);

    // The badge follows the row's value, and warns when it disagrees with the chosen scope.
    await page.getByLabel('Inference profile for Opus 5.5', { exact: true }).selectOption('global.anthropic.claude-opus-5-5');
    // The warning is in the text too, not only the colour.
    await expect(opusBadge).toHaveText('global (differs from Routing)');
    await expect(opusBadge).toHaveClass(/warn/);
    await pick('Global (recommended)');
    await expect(opusBadge).not.toHaveClass(/warn/);
    await page.getByLabel('Inference profile for Opus 5.5', { exact: true }).selectOption({ label: 'Other…' });
    await page.getByLabel('Inference profile for Opus 5.5, other value').fill('arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/abc');
    await expect(opusBadge).toHaveText('custom');
    await page.getByLabel('Inference profile for Opus 5.5, other value').fill('anthropic.claude-opus-5-5');
    await expect(opusBadge).toHaveText('in-region (differs from Routing)');

    // Discover fills only empty rows, and says which mapped rows use another scope than the chosen one.
    await pick('Geographic');
    await panel.getByRole('button', { name: 'Discover' }).click();
    await expect(panel.getByText(/1 row uses another scope; clear it and Discover again to re-suggest/)).toBeVisible();
    await expect(page.getByLabel('Inference profile for Opus 5.5, other value')).toHaveValue('anthropic.claude-opus-5-5');
    await panel.getByRole('button', { name: 'Save Bedrock settings' }).click();
    await expect.poll(async () => (await app.json('/api/settings')).settings.bedrock.scope).toBe('geo');
    await page.reload();
    await expect(panel.getByRole('group', { name: 'Routing' }).getByRole('radio', { name: 'Geographic' })).toBeChecked();

    // GovCloud has no global routing.
    await pick('Global (recommended)');
    await page.getByLabel('Region', { exact: true }).selectOption('us-gov-west-1');
    await expect(global).toBeDisabled();
    await expect(geo).toBeChecked();
    await expect(panel.getByText('GovCloud has no global routing.')).toBeVisible();
    await page.getByLabel('Region', { exact: true }).selectOption('ap-southeast-7');
    await expect(global).toBeEnabled();
    await expect(page.getByLabel('Region', { exact: true }).locator('option')).toHaveCount(36);
  } finally {
    discovery.inferenceProfiles = orig;
  }
});

test('settings: a Discover answer for a profile, region or Routing choice changed while it was pending is discarded', async ({ page }) => {
  const orig = discovery.inferenceProfiles;
  let release = () => {};
  discovery.inferenceProfiles = async () => {
    await new Promise<void>((r) => { release = r; });
    return [{ id: 'global.anthropic.claude-opus-5-5', arn: '', name: 'Global Opus 5.5', type: 'SYSTEM_DEFINED', anthropic: true }];
  };
  try {
    await page.goto('/settings#models');
    const panel = page.locator('.panel.agent-surfaces');
    await expect(panel.getByRole('group', { name: 'Routing' }).getByRole('radio', { name: 'Global (recommended)' })).toBeChecked();
    const changes: [string, () => Promise<unknown>][] = [
      ['Routing', () => panel.getByRole('group', { name: 'Routing' }).getByText('Geographic', { exact: true }).click()],
      ['region', () => page.getByLabel('Region', { exact: true }).selectOption('eu-west-1')],
      ['profile', () => page.getByLabel('AWS profile for Bedrock').selectOption('sandbox')],
    ];
    for (const [what, change] of changes) {
      await panel.getByRole('button', { name: 'Discover' }).click();
      await expect(panel.getByText('Asking Bedrock…'), what).toBeVisible();
      await change();
      release();
      await expect(panel.getByText(/changed.*Discover again/), what).toBeVisible();
      await expect(page.getByLabel('Inference profile for Opus 5.5', { exact: true }), what).toHaveValue('');
    }
  } finally {
    release();
    discovery.inferenceProfiles = orig;
  }
});

test('settings: Discover names the models left unmapped in the chosen scope and says why', async ({ page }) => {
  const orig = discovery.foundationModels;
  discovery.foundationModels = async () => { throw new Error('AccessDenied: bedrock:ListFoundationModels'); };
  try {
    await page.goto('/settings#models');
    const panel = page.locator('.panel.agent-surfaces');
    await panel.getByRole('group', { name: 'Routing' }).getByText('In-region', { exact: true }).click();
    await panel.getByRole('button', { name: 'Discover' }).click();
    await expect(panel.getByText(/No in-region option for: Opus 5\.5, Fable 5\.1\..*AccessDenied: bedrock:ListFoundationModels/)).toBeVisible();
  } finally {
    discovery.foundationModels = orig;
  }
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
