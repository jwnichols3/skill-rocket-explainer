import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runCli, freePort } from '../helpers/cli.ts';

const homes: string[] = [];
async function newHome() { const h = await mkdtemp(join(tmpdir(), 'explainer-cli-')); homes.push(h); return h; }
after(async () => {
  for (const h of homes) { await runCli(['stop'], { EXPLAINER_HOME: h }); await rm(h, { recursive: true, force: true }); }
});

test('start launches the app once; a second start reuses it; stop ends it', async () => {
  const home = await newHome();
  const port = String(await freePort());
  const first = await runCli(['start', '--port', port], { EXPLAINER_HOME: home });
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}`));
  const info1 = JSON.parse(await readFile(join(home, 'run', 'server.json'), 'utf8'));

  const res = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.equal((await res.json()).app, 'rocket-explainer');

  const second = await runCli(['start', '--port', port], { EXPLAINER_HOME: home });
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /already running/i);
  const info2 = JSON.parse(await readFile(join(home, 'run', 'server.json'), 'utf8'));
  assert.equal(info2.pid, info1.pid);

  const stop = await runCli(['stop'], { EXPLAINER_HOME: home });
  assert.equal(stop.code, 0, stop.stderr);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/status`));
});

test('doctor lists missing prerequisites with a fix and exits non-zero', async () => {
  const home = await newHome();
  // PATH holds only node itself, so ffmpeg is missing.
  const r = await runCli(['doctor'], { EXPLAINER_HOME: home, PATH: dirname(process.execPath) });
  assert.notEqual(r.code, 0);
  assert.match(r.stdout, /ffmpeg/);
  assert.match(r.stdout, /missing/i);
  assert.match(r.stdout, /fix: .*install/i);
});

test('doctor passes when prerequisites are present', async () => {
  const home = await newHome();
  const r = await runCli(['doctor'], { EXPLAINER_HOME: home });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /node/i);
});
