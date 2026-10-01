import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp, waitForJob, post, type TestApp } from '../helpers/app.ts';
import { compareVersions, RELEASE_REPO } from '../../src/routes/update.ts';
import { VERSION } from '../../src/version.ts';

// A stand-in for api.github.com: tests set what /releases/latest answers.
let latest: { status: number; body?: unknown } = { status: 404 };
const seen: { path: string; auth?: string; accept?: string }[] = [];
let gh: Server, base = '', app: TestApp;

const release = (tag: string) => ({
  tag_name: tag, html_url: `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`, published_at: '2026-09-30T00:00:00Z', body: 'notes',
  assets: [
    { name: 'install.sh', url: `${base}/assets/1`, browser_download_url: `${base}/dl/install.sh` },
    { name: `rocket-explainer-${tag.slice(1)}.tar.gz`, url: `${base}/assets/2`, browser_download_url: `${base}/dl/tarball` },
  ],
});
// The "install.sh" asset records what it was run with instead of installing anything.
const FAKE_INSTALL = `#!/bin/sh
echo "fake install $EXPLAINER_VERSION"
printf '%s\\n%s\\n' "$EXPLAINER_VERSION" "$EXPLAINER_HOME" > "$EXPLAINER_HOME/ran.txt"
cat "$EXPLAINER_TARBALL" >> "$EXPLAINER_HOME/ran.txt"
`;

before(async () => {
  gh = createServer((req, res) => {
    seen.push({ path: req.url!, auth: req.headers.authorization, accept: req.headers.accept });
    const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.url === `/repos/${RELEASE_REPO}/releases/latest`) return send(latest.status, latest.body ?? { message: 'Not Found' });
    const tag = /\/releases\/tags\/(.+)$/.exec(req.url!)?.[1];
    if (tag) return send(200, release(decodeURIComponent(tag)));
    if (req.url === '/assets/1') { res.writeHead(200); return res.end(FAKE_INSTALL); }
    if (req.url === '/assets/2') { res.writeHead(200); return res.end('TARBALL-BYTES\n'); }
    send(404, { message: 'Not Found' });
  });
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(gh.address() as any).port}`;
  process.env.EXPLAINER_GITHUB_API = base;
  process.env.GITHUB_TOKEN = 'test-token';
  app = await startTestApp();
});
after(async () => {
  await app?.stop();
  gh?.close();
});

const bump = (v: string, i: number, d: number) => { const n = v.split('.').map(Number); n[i] += d; return n.join('.'); };

test('semver ordering compares numbers, not strings, and ranks pre-releases lower', () => {
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('v1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(compareVersions('0.10.1', '0.9.12'), 1);
  assert.equal(compareVersions('10.0.0', '9.99.99'), 1);
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.2'), 1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.throws(() => compareVersions('latest', '1.0.0'), /not a version/);
});

test('a newer release is offered for install, with the token sent', async () => {
  const newer = bump(VERSION, 1, 1);
  latest = { status: 200, body: release(`v${newer}`) };
  const u = await app.json('/api/update');
  assert.equal(u.current, VERSION);
  assert.equal(u.latest, newer);
  assert.equal(u.tag, `v${newer}`);
  assert.equal(u.newer, true);
  assert.match(u.url, /releases\/tag\//);
  assert.equal(seen.at(-1)!.auth, 'Bearer test-token');
});

test('the same or an older release is not offered', async () => {
  latest = { status: 200, body: release(`v${VERSION}`) };
  assert.equal((await app.json('/api/update')).newer, false);
  latest = { status: 200, body: release('v0.0.0') };
  const u = await app.json('/api/update');
  assert.equal(u.latest, '0.0.0');
  assert.equal(u.newer, false);
});

test('a private repo (404 or 401) is reported, not failed', async () => {
  for (const status of [404, 401]) {
    latest = { status };
    const res = await app.api('/api/update');
    assert.equal(res.status, 200);
    const u = await res.json();
    assert.equal(u.newer, false);
    assert.equal(u.latest, null);
    assert.match(u.problem, /can't see releases \(private repo\?\)/);
  }
});

test('install downloads the release assets with the token and runs install.sh with the version', async () => {
  const tag = `v${bump(VERSION, 1, 1)}`;
  const job = await app.json('/api/update/install', post({ tag }));
  assert.equal(job.kind, 'update');
  const done = await waitForJob(app, job.id);
  assert.equal(done.status, 'succeeded', done.error ?? done.log.join('\n'));
  assert.deepEqual(done.result, { installed: tag.slice(1), restart: true });
  assert.ok(done.log.includes(`fake install ${tag}`), done.log.join('\n'));
  assert.equal(await readFile(join(app.home, 'ran.txt'), 'utf8'), `${tag}\n${app.home}\nTARBALL-BYTES\n`);
  const assets = seen.filter((s) => s.path.startsWith('/assets/'));
  assert.ok(assets.length >= 2);
  for (const a of assets) { assert.equal(a.auth, 'Bearer test-token'); assert.equal(a.accept, 'application/octet-stream'); }
});

test('restart refuses when the app was not installed with install.sh', async () => {
  const res = await app.api('/api/update/restart', post({}));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /explainer stop/);
});
