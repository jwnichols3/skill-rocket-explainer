import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestApp, post, type TestApp } from '../helpers/app.ts';
import { probeDurationMs } from '../../src/media.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('preview synthesizes a short line and serves it as audio', async () => {
  const { url } = await app.json('/api/tts/preview', post({ provider: 'fake', voiceId: 'fake-bright', controls: { rate: 120 } }));
  assert.match(url, /^\/media\/tts-preview\/[0-9a-f]{32}\.wav$/);
  const res = await app.api(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'audio/wav');
  const file = join(tmpdir(), `preview-${process.pid}.wav`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  assert.ok((await probeDurationMs(file)) > 1000);
});

test('the same voice and controls reuse the cached preview; other controls do not', async () => {
  const a = await app.json('/api/tts/preview', post({ provider: 'fake', voiceId: 'fake-deep', controls: {} }));
  const b = await app.json('/api/tts/preview', post({ provider: 'fake', voiceId: 'fake-deep', controls: {} }));
  const c = await app.json('/api/tts/preview', post({ provider: 'fake', voiceId: 'fake-deep', controls: { rate: 80 } }));
  assert.equal(a.url, b.url);
  assert.notEqual(a.url, c.url);
});

test('preview rejects bad input and the preview route serves nothing else', async () => {
  assert.equal((await app.api('/api/tts/preview', post({ provider: 'fake' }))).status, 400);
  assert.equal((await app.api('/api/tts/preview', post({ provider: 'nope', voiceId: 'x' }))).status, 400);
  assert.equal((await app.api('/media/tts-preview/..%2Fsettings.json')).status, 404);
  assert.equal((await app.api('/media/cache/tts-preview/x.wav')).status, 403);
});
