import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestApp, waitForJob, approvedExplainer, post, put, type TestApp } from '../helpers/app.ts';
import { probeDurationMs, probeStreams } from '../../src/media.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

async function build(id: string) {
  const job = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  assert.equal(job.status, 'succeeded', job.error);
  return { job, e: await app.json(`/api/explainers/${id}`) };
}

async function rerender(id: string) {
  const job = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/rerender`, post({}))).id);
  assert.equal(job.status, 'succeeded', job.error);
  return app.json(`/api/explainers/${id}`);
}

async function download(url: string) {
  const res = await app.api(url);
  assert.equal(res.status, 200);
  const f = join(await mkdtemp(join(tmpdir(), 'dl-')), 'v.mp4');
  await writeFile(f, Buffer.from(await res.arrayBuffer()));
  return f;
}

test('building needs an approved plan', async () => {
  const e = await app.json('/api/explainers', post({ brief: 'x', sources: [{ kind: 'note', value: 'y' }] }));
  assert.equal((await app.api(`/api/explainers/${e.id}/outputs/video/build`, post({}))).status, 400);
});

test('build: script, narration and render per scene, assembled to a narrated MP4 with a scene time map', async () => {
  const { id } = await approvedExplainer(app);
  const { job, e } = await build(id);
  assert.equal(e.status, 'built');
  const out = e.outputs.video;
  assert.equal(out.rounds.length, 1);
  const r = out.rounds[0];
  assert.deepEqual(r.scenes.map((s: any) => s.id), ['s1', 's2', 's3']);
  let t = 0;
  for (const s of r.scenes) { assert.equal(s.startMs, t); assert.ok(s.durationMs > 0); t += s.durationMs; }
  const file = await download(r.url);
  assert.deepEqual((await probeStreams(file)).sort(), ['audio', 'video']);
  assert.ok(Math.abs((await probeDurationMs(file)) - t) < 500);
  // Progress named stages and scenes.
  const log = job.log.join('\n');
  for (const stage of ['Writing the script', 'Narrating', 'Rendering', 'Packaging']) assert.match(log, new RegExp(stage));
  assert.match(log, /scene 2\/3/);
});

test('a comment pinned to a timestamp re-renders only that scene, and the result reflects it', async () => {
  const { id } = await approvedExplainer(app);
  const { e } = await build(id);
  const s2 = e.outputs.video.rounds[0].scenes[1];
  await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'show the replay arrow', atMs: s2.startMs + 100 }));
  const x = await rerender(id);
  const r2 = x.outputs.video.rounds[1];
  assert.deepEqual(r2.rendered, ['s2']);
  assert.match(r2.scenes[1].visuals, /show the replay arrow/);
  assert.equal(r2.scenes[0].visuals, e.outputs.video.rounds[0].scenes[0].visuals);
  assert.equal(r2.basedOn, 1);
});

test('a comment pinned to a scene re-renders only that scene', async () => {
  const { id } = await approvedExplainer(app);
  await build(id);
  await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'end on the winner', sceneId: 's3' }));
  const x = await rerender(id);
  assert.deepEqual(x.outputs.video.rounds[1].rendered, ['s3']);
});

test('the narration script is editable; edits re-narrate and re-render only changed scenes', async () => {
  const { id } = await approvedExplainer(app);
  const { e } = await build(id);
  const script = e.outputs.video.script;
  assert.equal(script.length, 3);
  const edited = script.map((s: any) => s.id === 's1' ? { ...s, narration: 'Two options. One decision. Zero regrets, hopefully.' } : s);
  await app.json(`/api/explainers/${id}/outputs/video/script`, put({ scenes: edited }));
  const x = await rerender(id);
  const r2 = x.outputs.video.rounds[1];
  assert.deepEqual(r2.narrated, ['s1']);
  assert.deepEqual(r2.rendered, ['s1']);
  assert.equal(r2.scenes[0].narration, 'Two options. One decision. Zero regrets, hopefully.');
});

test('export writes the MP4 to a path the user chooses', async () => {
  const { id } = await approvedExplainer(app);
  await build(id);
  const dir = await mkdtemp(join(tmpdir(), 'export-'));
  const named = await app.json(`/api/explainers/${id}/outputs/video/export`, post({ path: join(dir, 'final.mp4') }));
  assert.equal(named.files[0], join(dir, 'final.mp4'));
  assert.ok((await stat(named.files[0])).size > 0);
  const intoDir = await app.json(`/api/explainers/${id}/outputs/video/export`, post({ path: join(dir, 'sub') + '/' }));
  assert.match(intoDir.files[0], /sub\/.+\.mp4$/);
  assert.ok((await stat(intoDir.files[0])).size > 0);
});
