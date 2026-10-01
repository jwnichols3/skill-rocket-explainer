import { test, expect } from './fixtures.ts';

const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('settings: check for update offers a newer release, installs it and offers a restart', async ({ page, app }) => {
  const { version } = await app.json('/api/status');
  await page.route('**/api/update', (r) => r.fulfill(json({ current: version, latest: '9.0.0', tag: 'v9.0.0', newer: true, url: 'https://example.com/releases/v9.0.0' })));
  await page.route('**/api/update/install', (r) => r.fulfill(json({ id: 'job_upd', kind: 'update', status: 'queued' })));
  await page.route('**/api/jobs/job_upd', (r) => r.fulfill(json({
    id: 'job_upd', kind: 'update', status: 'succeeded', stage: 'done', progress: 1, detail: null, log: ['fake install v9.0.0'],
    error: null, result: { installed: '9.0.0', restart: true }, createdAt: new Date().toISOString(), startedAt: new Date().toISOString(), endedAt: new Date().toISOString(),
  })));

  await page.goto('/settings#about');
  const panel = page.locator('.panel.version');
  await expect(panel.locator('#installed-version')).toHaveText(`v${version}`);
  await panel.getByRole('button', { name: 'Check for update' }).click();
  await expect(panel).toContainText('v9.0.0 is available');
  await expect(panel.getByRole('link', { name: 'Release notes' })).toHaveAttribute('href', 'https://example.com/releases/v9.0.0');
  await panel.getByRole('button', { name: 'Install v9.0.0' }).click();
  await expect(panel).toContainText('v9.0.0 is installed. Restart the app to use it.');
  await expect(panel.getByRole('button', { name: 'Restart now' })).toBeVisible();
  await expect(panel).toContainText('explainer restart');
});

test('settings: check for update says when up to date, and when releases are not visible', async ({ page }) => {
  let answer: unknown = { current: '1.10.0', latest: '1.10.0', tag: 'v1.10.0', newer: false };
  await page.route('**/api/update', (r) => r.fulfill(json(answer)));
  await page.goto('/settings#about');
  const panel = page.locator('.panel.version');
  const check = panel.getByRole('button', { name: 'Check for update' });
  await check.click();
  await expect(panel).toContainText("You're up to date: the latest release is v1.10.0.");
  await expect(panel.getByRole('button', { name: /^Install/ })).toHaveCount(0);

  answer = { current: '1.10.0', latest: null, newer: false, problem: "can't see releases (private repo?)" };
  await check.click();
  await expect(panel.locator('.callout.warn')).toHaveText("can't see releases (private repo?)");
});
