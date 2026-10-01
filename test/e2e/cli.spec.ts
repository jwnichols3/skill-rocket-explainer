import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, freePort } from '../helpers/cli.ts';

test('explainer start serves the app; doctor reports prerequisites', async ({ page }) => {
  const home = await mkdtemp(join(tmpdir(), 'explainer-e2e-cli-'));
  try {
    const port = await freePort();
    const start = await runCli(['start', '--port', String(port)], { EXPLAINER_HOME: home });
    expect(start.code, start.stderr).toBe(0);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByRole('heading', { name: 'Rocket Explainer' })).toBeVisible();

    const doctor = await runCli(['doctor'], { EXPLAINER_HOME: home });
    expect(doctor.stdout).toMatch(/ok\s+ffmpeg/);
  } finally {
    await runCli(['stop'], { EXPLAINER_HOME: home });
    await rm(home, { recursive: true, force: true });
  }
});
