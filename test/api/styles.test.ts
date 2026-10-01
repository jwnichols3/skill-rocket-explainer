import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestApp, waitForJob, post, put, type TestApp } from '../helpers/app.ts';
import { probeStreams, probeDurationMs } from '../../src/media.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const VOICE = { provider: 'fake', voiceId: 'fake-bright', controls: { rate: 110 } };
const DESCRIPTION = 'Hitchhiker\'s Guide animations, smooth transitions, camera movement, neon blue/green, high contrast, lively, room for humor';

test('a style can be created without a name and is listed', async () => {
  const style = await app.json('/api/styles', post({ description: DESCRIPTION, voice: VOICE }));
  assert.equal(style.name, null);
  assert.equal(style.description, DESCRIPTION);
  const list = await app.json('/api/styles');
  assert.ok(list.some((s: any) => s.id === style.id));
});

test('a named style keeps its name', async () => {
  const style = await app.json('/api/styles', post({ name: 'Neon Noir', description: 'dark, rainy, neon', voice: VOICE }));
  assert.equal(style.name, 'Neon Noir');
  assert.equal((await app.json(`/api/styles/${style.id}`)).name, 'Neon Noir');
});

test('rendering a sample produces a round with instructions, playable media, model and voice', async () => {
  const style = await app.json('/api/styles', post({ description: DESCRIPTION, voice: VOICE }));
  const job = await app.json(`/api/styles/${style.id}/sample`, post({}));
  const done = await waitForJob(app, job.id);
  assert.equal(done.status, 'succeeded', JSON.stringify(done.log));

  const s = await app.json(`/api/styles/${style.id}`);
  assert.equal(s.rounds.length, 1);
  const round = s.rounds[0];
  assert.equal(round.n, 1);
  assert.equal(round.model, 'claude-opus-5-5');
  assert.equal(round.effort, 'high');
  assert.deepEqual(round.voice, VOICE);
  assert.equal(s.currentRound, 1);

  // Instruction snapshot is a DESIGN.md with tokens and the required sections.
  const design = await (await app.api(round.designUrl)).text();
  assert.match(design, /^---\n[\s\S]*colors:[\s\S]*\n---\n/);
  for (const section of ['Identity', 'Motion', 'Camera', 'Voice', 'Video', 'Deck', 'Doc', 'Visual']) assert.match(design, new RegExp(`^## ${section}`, 'm'));
  assert.match(design, /neon blue\/green/i);

  // Sample: served as MP4 with video and audio, ~10 s, scene plan exercising every element.
  const media = await app.api(round.sampleUrl);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
  const file = join(tmpdir(), `sample-${style.id}.mp4`);
  await writeFile(file, Buffer.from(await media.arrayBuffer()));
  assert.deepEqual((await probeStreams(file)).sort(), ['audio', 'video']);
  const dur = await probeDurationMs(file);
  assert.ok(dur > 6000 && dur < 16000, `sample is ${dur}ms`);
  const elements = new Set(round.scenes.flatMap((sc: any) => sc.elements));
  for (const e of ['opening', 'transition', 'text-popups', 'boxes', 'diagram', 'camera']) assert.ok(elements.has(e), `sample lacks ${e}`);
});

test('video seeking works: the sample is served with byte ranges', async () => {
  const style = await app.json('/api/styles', post({ description: DESCRIPTION, voice: VOICE }));
  await waitForJob(app, (await app.json(`/api/styles/${style.id}/sample`, post({}))).id);
  const s = await app.json(`/api/styles/${style.id}`);
  const res = await app.api(s.rounds[0].sampleUrl, { headers: { range: 'bytes=0-99' } });
  assert.equal(res.status, 206);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test('only one job runs per style at a time; the active job is findable after a reload', async () => {
  await app.json('/api/settings', put({ fake: { delayMs: 800 } }));
  try {
    const style = await app.json('/api/styles', post({ description: DESCRIPTION, voice: VOICE }));
    const job = await app.json(`/api/styles/${style.id}/sample`, post({}));
    const second = await app.api(`/api/styles/${style.id}/sample`, post({}));
    assert.equal(second.status, 409);
    const active = await app.json(`/api/jobs?target=style:${style.id}&active=1`);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, job.id);
    assert.ok(['queued', 'running'].includes(active[0].status));
    await waitForJob(app, job.id);
  } finally {
    await app.json('/api/settings', put({ fake: { delayMs: 0 } }));
  }
});

test('a failing job is marked failed, keeps its log, and creates no round', async () => {
  await app.json('/api/settings', put({ fake: { failKinds: ['style-sample'] } }));
  try {
    const style = await app.json('/api/styles', post({ description: DESCRIPTION, voice: VOICE }));
    const job = await waitForJob(app, (await app.json(`/api/styles/${style.id}/sample`, post({}))).id);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /fake failure/);
    assert.ok(job.log.length > 0);
    const s = await app.json(`/api/styles/${style.id}`);
    assert.equal(s.rounds.length, 0);
    // Log also persisted to disk.
    const onDisk = JSON.parse(await readFile(join(app.home, 'jobs', `${job.id}.json`), 'utf8'));
    assert.equal(onDisk.status, 'failed');
  } finally {
    await app.json('/api/settings', put({ fake: { failKinds: [] } }));
  }
});

test('voices and capabilities for the selected provider are listed', async () => {
  const voices = await app.json('/api/tts/fake/voices');
  assert.ok(voices.length >= 2);
  const caps = await app.json('/api/tts/fake/voices/fake-deep/capabilities');
  assert.ok(caps.controls.rate);
  assert.match(caps.unsupported.pitch, /pitch/);
});
