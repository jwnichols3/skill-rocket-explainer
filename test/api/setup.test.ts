import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, post, type TestApp } from '../helpers/app.ts';
import { runCli, freePort } from '../helpers/cli.ts';

const cleanups: (() => Promise<void>)[] = [];
after(async () => { for (const c of cleanups) await c(); });

const FAKES = { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'fake', doc: 'fake', visual: 'fake' } };

function hostStatus(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/status', headers: { host } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject);
    req.end();
  });
}

test('setup via the API: reports what is incomplete, saves choices, and is safe to re-run', async () => {
  const app: TestApp = await startTestApp({ setupComplete: false });
  cleanups.push(() => app.stop());
  const before = await app.json('/api/setup');
  assert.equal(before.complete, false);
  assert.ok(before.checks.some((c: any) => c.id === 'ffmpeg'));
  const done = await app.json('/api/setup', post({ publicUrl: 'https://explainer.devbox.example', providers: FAKES }));
  assert.equal(done.complete, true);
  assert.equal(done.settings.publicUrl, 'https://explainer.devbox.example');
  assert.deepEqual(done.settings.publicHostnames, ['explainer.devbox.example']);
  assert.equal(await hostStatus(app.port, 'explainer.devbox.example'), 200);
  const again = await app.json('/api/setup', post({ publicUrl: 'https://explainer.devbox.example', providers: FAKES }));
  assert.deepEqual(again.settings.publicHostnames, ['explainer.devbox.example']);
  const bad = await app.api('/api/setup', post({ publicUrl: 'not a url' }));
  assert.equal(bad.status, 400);
});

test('explainer setup (CLI): writes real-provider defaults, starts the app, accepts the proxy host, re-runs safely', async () => {
  const home = await mkdtemp(join(tmpdir(), 'explainer-setup-'));
  cleanups.push(async () => { await runCli(['stop'], { EXPLAINER_HOME: home }); await rm(home, { recursive: true, force: true }); });
  const port = await freePort();
  const r = await runCli(['setup', '--yes', '--port', String(port), '--public-url', 'https://explainer.devbox.example'], { EXPLAINER_HOME: home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /https:\/\/explainer\.devbox\.example/);
  const s = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
  assert.equal(s.setupComplete, true);
  assert.equal(s.port, port);
  assert.equal(s.providers.agent, 'claude-subscription');
  // ADR 0002: HyperFrames renders video by default, with Opus 5.5 at high effort.
  assert.equal(s.providers.renderer.video, 'hyperframes');
  assert.deepEqual(s.defaults, { model: 'claude-opus-5-5', effort: 'high' });
  assert.equal(await hostStatus(port, 'explainer.devbox.example'), 200);

  // Re-running keeps choices made since, and doesn't duplicate the seed style.
  await writeFile(join(home, 'settings.json'), JSON.stringify({ ...s, providers: { ...s.providers, ...FAKES } }));
  const again = await runCli(['setup', '--yes'], { EXPLAINER_HOME: home });
  assert.equal(again.code, 0, again.stdout + again.stderr);
  const s2 = JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
  assert.equal(s2.providers.agent, 'fake');
  const styles = await (await fetch(`http://127.0.0.1:${port}/api/styles`)).json();
  assert.equal(styles.filter((x: any) => x.name === "Hitchhiker's Guide").length, 1);

  // URLs printed by the CLI use the proxy address.
  const n = await runCli(['new', '--brief', 'x', '--source', '/tmp', '--no-open'], { EXPLAINER_HOME: home });
  assert.match(n.stdout.trim(), /^https:\/\/explainer\.devbox\.example\/explainers\/ex_\w+$/);
});
