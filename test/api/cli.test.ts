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

test('new creates an explainer through the API, starts the source report, and prints its URL', async () => {
  const home = await newHome();
  const port = String(await freePort());
  assert.equal((await runCli(['start', '--port', port], { EXPLAINER_HOME: home })).code, 0);
  const base = `http://127.0.0.1:${port}`;
  const style = await (await fetch(`${base}/api/styles`, { method: 'POST', headers: { 'x-explainer': '1', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Neon Guide', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }) })).json();
  const r = await runCli(['new', '--brief', 'the options call', '--source', '/tmp', '--source', 'https://example.com/paper', '--style', 'neon guide', '--type', 'deck'], { EXPLAINER_HOME: home });
  assert.equal(r.code, 0, r.stderr);
  const url = r.stdout.trim().split('\n').at(-1)!;
  assert.match(url, new RegExp(`^${base}/explainers/ex_\\w+$`));
  const e = await (await fetch(`${base}/api/explainers/${url.split('/').pop()}`)).json();
  assert.equal(e.brief, 'the options call');
  assert.deepEqual(e.sources.map((s: any) => [s.kind, s.value]), [['path', '/tmp'], ['url', 'https://example.com/paper']]);
  assert.equal(e.styleId, style.id);
  assert.equal(e.outputType, 'deck');
  const jobs = await (await fetch(`${base}/api/jobs?target=explainer:${e.id}`)).json();
  assert.equal(jobs[0].kind, 'source-report');

  const bad = await runCli(['new', '--brief', 'x', '--style', 'nope'], { EXPLAINER_HOME: home });
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /no style matches "nope".*Neon Guide/s);
});
