import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startTestApp, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

/** fetch() won't let us forge Host, so use node:http directly. */
function raw(method: string, path: string, headers: Record<string, string>): Promise<number> {
  const u = new URL(app.url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, method, path, headers }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject);
    req.end();
  });
}

test('rejects requests whose Host is not on the allowlist', async () => {
  assert.equal(await raw('GET', '/api/status', { host: 'evil.example:80' }), 403);
  assert.equal(await raw('GET', '/api/status', { host: `127.0.0.1:${new URL(app.url).port}` }), 200);
});

test('rejects requests from an off-allowlist Origin', async () => {
  const host = `127.0.0.1:${new URL(app.url).port}`;
  assert.equal(await raw('GET', '/api/status', { host, origin: 'https://evil.example' }), 403);
  assert.equal(await raw('GET', '/api/status', { host, origin: `http://${host}` }), 200);
});

test('rejects mutating requests without the custom header', async () => {
  const res = await fetch(app.url + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const ok = await app.api('/api/settings', { method: 'PUT', body: '{}' });
  assert.equal(ok.status, 200);
});

test('creates the data dir with settings, styles, explainers and logs areas as plain files', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const entries = await readdir(app.home);
  for (const name of ['settings.json', 'styles', 'explainers', 'logs']) assert.ok(entries.includes(name), `missing ${name} in ${entries}`);
  const settings = JSON.parse(await readFile(`${app.home}/settings.json`, 'utf8'));
  assert.equal(settings.host, '127.0.0.1');
});

test('provider implementations are selected through settings; unknown ones are refused', async () => {
  const status = await app.json('/api/status');
  assert.deepEqual([status.providers.agent, status.providers.tts, status.providers.renderer.video], ['fake', 'fake', 'fake']);
  const bad = await app.api('/api/settings', { method: 'PUT', body: JSON.stringify({ providers: { tts: 'nope' } }) });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /unknown TTS provider "nope"/);
});

test('a reverse-proxy hostname added in settings is allowed in Host and Origin', async () => {
  assert.equal(await raw('GET', '/api/status', { host: 'explainer.devbox.example' }), 403);
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ publicHostnames: ['explainer.devbox.example'] }) });
  assert.equal(await raw('GET', '/api/status', { host: 'explainer.devbox.example', origin: 'https://explainer.devbox.example' }), 200);
});

test('media paths cannot escape the styles/explainers areas', async () => {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${app.home}/secrets.json`, '{"key":"CANARY-SECRET"}');
  const u = new URL(app.url);
  const get = (path: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: u.hostname, port: u.port, path, headers: { host: u.host } }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject);
    req.end();
  });
  for (const path of ['/media/styles/%2e%2e/secrets.json', '/media/styles/..%2Fsecrets.json', '/media/styles/%2E%2E%2Fsecrets.json', '/media/explainers/../secrets.json', '/media/secrets.json']) {
    const r = await get(path);
    assert.ok(!r.body.includes('CANARY-SECRET'), `${path} leaked secrets (status ${r.status})`);
  }
});
