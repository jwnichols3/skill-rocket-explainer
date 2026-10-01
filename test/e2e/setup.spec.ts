import { test as base, expect } from '@playwright/test';
import { startTestApp, type TestApp } from '../helpers/app.ts';

const test = base.extend<{ app: TestApp }>({
  app: async ({}, use) => { const app = await startTestApp({ setupComplete: false }); await use(app); await app.stop(); },
  baseURL: async ({ app }, use) => { await use(app.url); },
});

test('first run: home points to setup; setup takes a proxy URL and providers, shows checks, and finishes', async ({ page, app }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Finish setup' }).click();
  await expect(page.locator('.check').filter({ has: page.locator('strong', { hasText: /^ffmpeg$/ }) }).locator('.badge')).toHaveText('ok');
  await page.getByLabel('Reverse-proxy URL').fill('https://explainer.devbox.example/');
  await page.getByLabel('Agent surface').selectOption('fake');
  await page.getByLabel('Voice provider').selectOption('fake');
  await page.getByLabel('Video renderer').selectOption('fake');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Rocket Explainer' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Finish setup' })).toHaveCount(0);
  const { settings } = await app.json('/api/settings');
  expect(settings.publicUrl).toBe('https://explainer.devbox.example');
  expect(settings.publicHostnames).toEqual(['explainer.devbox.example']);
});

test('new explainer page: style and output prefilled from the skill, including a loose style match', async ({ page, app }) => {
  await app.json('/api/styles', { method: 'POST', body: JSON.stringify({ name: "Hitchhiker's Guide", description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }) });
  await page.goto('/new?brief=why&style=hitchhikers&type=deck');
  await expect(page.getByLabel('Style', { exact: true }).locator('option:checked')).toHaveText("Hitchhiker's Guide");
  await expect(page.getByLabel('Output', { exact: true })).toHaveValue('deck');
});
