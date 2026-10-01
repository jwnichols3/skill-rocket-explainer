import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, waitForJob, post, type TestApp } from '../helpers/app.ts';
import { exec } from '../../src/media.ts';
import { makeReferenceMedia } from '../helpers/media.ts';
import { sampleFrames } from '../../src/pipeline/style-helpers.ts';

let app: TestApp;
let media: string;
const VOICE = { provider: 'fake', voiceId: 'fake-bright', controls: {} };

before(async () => {
  app = await startTestApp();
  media = await mkdtemp(join(tmpdir(), 'explainer-media-'));
  await makeReferenceMedia(media);
});
after(async () => { await app.stop(); await rm(media, { recursive: true, force: true }); });

const newStyle = () => app.json('/api/styles', post({ description: 'neon blue/green, high contrast', voice: VOICE }));
const upload = async (id: string, file: string, type: string, name = file) =>
  app.api(`/api/styles/${id}/references?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'content-type': type }, body: await readFile(join(media, file)) });

test('frame sampling: scene cuts plus an interval, at most one per second, capped and downscaled', async () => {
  const out = join(media, 'frames');
  // Scene detection alone (interval off): one frame per shot, at the cuts.
  const cuts = await sampleFrames(join(media, 'clip.mp4'), out, { intervalS: 100 });
  assert.equal(cuts.length, 4, `${cuts.map((f) => f.atMs)}`);
  [0, 2500, 5000, 7500].forEach((cut, i) => assert.ok(Math.abs(cuts[i].atMs - cut) <= 120, `frame ${i} at ${cuts[i].atMs} ms, cut at ${cut}`));
  // With the interval: about one per second, never two within 1 s.
  const frames = await sampleFrames(join(media, 'clip.mp4'), out, { maxFrames: 24 });
  assert.ok(frames.length >= 8 && frames.length <= 11, `${frames.length} frames`);
  for (let i = 1; i < frames.length; i++) assert.ok(frames[i].atMs - frames[i - 1].atMs >= 1000, 'frames closer than 1 s');
  const r = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', join(out, frames[0].file)]);
  assert.equal(r.stdout.trim(), '768');

  const capped = await sampleFrames(join(media, 'clip.mp4'), out, { maxFrames: 3 });
  assert.equal(capped.length, 3);
  assert.equal((await readdir(out)).length, 3);
});

test('reference images upload as raw bytes, are served back, and can be removed', async () => {
  const s = await newStyle();
  const res = await upload(s.id, 'ref.png', 'image/png', 'moodboard.png');
  assert.equal(res.status, 200);
  const ref = await res.json();
  assert.equal(ref.kind, 'image');
  assert.equal(ref.name, 'moodboard.png');
  const view = await app.json(`/api/styles/${s.id}`);
  const served = await app.api(view.references[0].fileUrl);
  assert.equal(served.headers.get('content-type'), 'image/png');

  // Declared type must match the bytes, and only images/videos are accepted.
  assert.equal((await upload(s.id, 'clip.mp4', 'image/png')).status, 415);
  assert.equal((await app.api(`/api/styles/${s.id}/references`, { method: 'POST', headers: { 'content-type': 'image/svg+xml' }, body: '<svg/>' })).status, 415);

  const after = await app.json(`/api/styles/${s.id}/references/${ref.id}`, { method: 'DELETE' });
  assert.equal(after.references.length, 0);
  assert.equal((await app.api(view.references[0].fileUrl)).status, 404);
});

test('links and local paths attach; bad ones are rejected', async () => {
  const s = await newStyle();
  const link = await app.json(`/api/styles/${s.id}/references`, post({ url: 'https://example.com/look', note: 'the title cards' }));
  assert.deepEqual([link.kind, link.url, link.note], ['link', 'https://example.com/look', 'the title cards']);
  assert.equal((await app.api(`/api/styles/${s.id}/references`, post({ url: 'javascript:alert(1)' }))).status, 400);
  const byPath = await app.json(`/api/styles/${s.id}/references`, post({ path: join(media, 'ref.png') }));
  assert.equal(byPath.kind, 'image');
  assert.equal((await app.api(`/api/styles/${s.id}/references`, post({ path: join(media, 'nope.png') }))).status, 400);
  assert.equal((await app.api(`/api/styles/${s.id}/references`, post({ path: join(media, 'notes.txt') }))).status, 415);
});

test('references inform the sample: images copied into the agent workdir, links listed', async () => {
  const s = await newStyle();
  const img = await (await upload(s.id, 'ref.png', 'image/png', 'board.png')).json();
  await app.json(`/api/styles/${s.id}/references`, post({ url: 'https://example.com/look', note: 'title cards' }));
  const job = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  assert.equal(job.status, 'succeeded', job.error);
  const agentDir = join(app.home, 'work', job.id, 'agent');
  const inputs = JSON.parse(await readFile(join(agentDir, 'inputs.json'), 'utf8'));
  assert.deepEqual(inputs.references, [
    { kind: 'image', name: 'board.png', file: `references/${img.file}` },
    { kind: 'link', url: 'https://example.com/look', note: 'title cards' },
  ]);
  assert.ok((await readFile(join(agentDir, inputs.references[0].file))).length > 0);
});

test('reference video: frames sampled, instructions land in the description and DESIGN.md before the first sample', async () => {
  const s = await newStyle();
  const vid = await (await upload(s.id, 'clip.mp4', 'video/mp4', 'reference.mp4')).json();
  assert.equal(vid.kind, 'video');
  const started = await app.json(`/api/styles/${s.id}/references/${vid.id}/analyze`, post({}));
  assert.equal(started.kind, 'style-reference-video');
  const job = await waitForJob(app, started.id);
  assert.equal(job.status, 'succeeded', job.error);
  assert.ok(job.log.some((l: string) => l.includes('Sampling frames')));
  assert.ok(job.result.designUpdated);

  const view = await app.json(`/api/styles/${s.id}`);
  assert.equal(view.rounds.length, 0);
  const n = job.result.frames;
  assert.match(view.description, /^neon blue\/green, high contrast\n\nFrom the reference video "reference.mp4":\n- Fake: \d+ frames/);
  assert.match(view.design, new RegExp(`From the reference video \\(${n} frames\\)`));
  const ref = view.references[0];
  assert.equal(ref.frameUrls.length, n);
  assert.equal((await app.api(ref.frameUrls[0])).headers.get('content-type'), 'image/jpeg');

  // The task: frames in the workdir, tools limited to Read and Write.
  const inputs = JSON.parse(await readFile(join(app.home, 'work', job.id, 'agent', 'inputs.json'), 'utf8'));
  assert.equal(inputs.frames.length, n);
  assert.equal(inputs.video.name, 'reference.mp4');
  assert.ok(inputs.video.durationMs > 9000);

  // The first sample builds on the draft.
  const sample = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  assert.equal(sample.status, 'succeeded', sample.error);
  const sampleInputs = JSON.parse(await readFile(join(app.home, 'work', sample.id, 'agent', 'inputs.json'), 'utf8'));
  assert.match(sampleInputs.currentDesign, /From the reference video/);
  assert.equal(sampleInputs.references[0].kind, 'video');

  // Only videos can be analyzed.
  const link = await app.json(`/api/styles/${s.id}/references`, post({ url: 'https://example.com' }));
  assert.equal((await app.api(`/api/styles/${s.id}/references/${link.id}/analyze`, post({}))).status, 400);
});

test('a failed analysis leaves the style untouched', async () => {
  await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ fake: { failKinds: ['style-reference-video'] } }) });
  try {
    const s = await newStyle();
    const vid = await (await upload(s.id, 'clip.mp4', 'video/mp4')).json();
    const job = await waitForJob(app, (await app.json(`/api/styles/${s.id}/references/${vid.id}/analyze`, post({}))).id);
    assert.equal(job.status, 'failed');
    assert.match(job.error, /fake failure/);
    const view = await app.json(`/api/styles/${s.id}`);
    assert.equal(view.description, 'neon blue/green, high contrast');
    assert.doesNotMatch(view.design, /reference video/);
  } finally {
    await app.json('/api/settings', { method: 'PUT', body: JSON.stringify({ fake: { failKinds: [] } }) });
  }
});

test('suggestions: 3-6 concrete, topic-tagged additions for a description', async () => {
  const { suggestions } = await app.json('/api/styles/suggest', post({ description: 'retro computer explainer' }));
  assert.ok(suggestions.length >= 3 && suggestions.length <= 6);
  for (const s of suggestions) { assert.equal(typeof s.text, 'string'); assert.ok(s.topic); }
  assert.equal((await app.api('/api/styles/suggest', post({ description: ' ' }))).status, 400);
});
