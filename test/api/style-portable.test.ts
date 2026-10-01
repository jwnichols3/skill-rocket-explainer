import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, waitForJob, post, type TestApp } from '../helpers/app.ts';
import { makeReferenceMedia } from '../helpers/media.ts';

// Two data dirs: export from one machine, import on another.
let from: TestApp;
let to: TestApp;
let media: string;
const VOICE = { provider: 'fake', voiceId: 'fake-bright', controls: { rate: 110 } };

before(async () => {
  [from, to] = await Promise.all([startTestApp(), startTestApp()]);
  media = await mkdtemp(join(tmpdir(), 'explainer-media-'));
  await makeReferenceMedia(media);
});
after(async () => { await Promise.all([from.stop(), to.stop()]); await rm(media, { recursive: true, force: true }); });

const importFile = (app: TestApp, body: string) =>
  app.api('/api/styles/import', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });

/** A tuned style: a round of samples, an image, a link and an analyzed reference video. */
async function tunedStyle(name: string) {
  const s = await from.json('/api/styles', post({ name, description: 'neon blue/green, high contrast', voice: VOICE, model: 'claude-sonnet-5-5', effort: 'medium' }));
  await waitForJob(from, (await from.json(`/api/styles/${s.id}/sample`, post({}))).id);
  await from.api(`/api/styles/${s.id}/references?name=look.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: await readFile(join(media, 'ref.png')) });
  await from.json(`/api/styles/${s.id}/references`, post({ url: 'https://example.com/look', note: 'the title cards' }));
  const video = await (await from.api(`/api/styles/${s.id}/references?name=clip.mp4`, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: await readFile(join(media, 'clip.mp4')) })).json();
  await waitForJob(from, (await from.json(`/api/styles/${s.id}/references/${video.id}/analyze`, post({}))).id);
  return from.json(`/api/styles/${s.id}`);
}

test('an exported style imports on another machine with its instructions, settings and references', async () => {
  const original = await tunedStyle('Neon Noir');
  const res = await from.api(`/api/styles/${original.id}/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition') ?? '', /attachment; filename="neon-noir\.style\.json"/);
  const file = await res.text();

  const imported = await (await importFile(to, file)).json();
  assert.notEqual(imported.id, original.id);
  assert.equal(imported.name, 'Neon Noir');
  assert.ok(imported.savedAt, 'a named style imports as saved');
  for (const k of ['description', 'voice', 'model', 'effort', 'design']) assert.deepEqual(imported[k], original[k], k);
  assert.deepEqual(imported.palette, original.palette);
  // Samples stay behind (they are large); the importer renders their own.
  assert.equal(imported.rounds.length, 0);
  assert.equal(imported.currentRound, null);

  const kinds = (s: any) => s.references.map((r: any) => r.kind);
  assert.deepEqual(kinds(imported), kinds(original));
  const [image, link, video] = imported.references;
  const served = await to.api(image.fileUrl);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), await readFile(join(media, 'ref.png')));
  assert.equal(image.name, 'look.png');
  assert.deepEqual({ url: link.url, note: link.note }, { url: 'https://example.com/look', note: 'the title cards' });
  // A reference video travels as what was learned from it, not as the video.
  assert.equal(video.name, 'clip.mp4');
  assert.equal(video.instructions, original.references[2].instructions);
  assert.ok(video.instructions);
  assert.equal(video.file, undefined);
  const again = await to.api(`/api/styles/${imported.id}/references/${video.id}/analyze`, post({}));
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /add the video again/);

  // It works like any other style: the next sample renders.
  const job = await waitForJob(to, (await to.json(`/api/styles/${imported.id}/sample`, post({}))).id);
  assert.equal(job.status, 'succeeded', JSON.stringify(job.log));
});

test('the export file is portable: no ids, paths or machine details', async () => {
  const s = await from.json('/api/styles', post({ name: 'Plain', description: 'calm, paper white', voice: VOICE }));
  const doc = await (await from.api(`/api/styles/${s.id}/export`)).json();
  assert.equal(doc.format, 'rocket-explainer-style');
  assert.equal(doc.version, 1);
  const text = JSON.stringify(doc);
  assert.ok(!text.includes(s.id), 'leaks the style id');
  assert.ok(!text.includes(from.home), 'leaks the data dir');
});

test('importing a style whose name is taken keeps both, the import marked as such', async () => {
  const s = await from.json('/api/styles', post({ name: 'Twin', description: 'twin', voice: VOICE }));
  const file = await (await from.api(`/api/styles/${s.id}/export`)).text();
  const first = await (await importFile(to, file)).json();
  const second = await (await importFile(to, file)).json();
  assert.equal(first.name, 'Twin');
  assert.equal(second.name, 'Twin (imported)');
  assert.equal((await to.json('/api/styles')).filter((x: any) => x.name?.startsWith('Twin')).length, 2);
});

test('an unnamed draft exports and imports as a draft', async () => {
  const s = await from.json('/api/styles', post({ description: 'draft look', voice: VOICE }));
  const res = await from.api(`/api/styles/${s.id}/export`);
  assert.match(res.headers.get('content-disposition') ?? '', /filename="untitled-style\.style\.json"/);
  const imported = await (await importFile(to, await res.text())).json();
  assert.equal(imported.name, null);
  assert.equal(imported.savedAt, null);
});

test('files that are not style exports are refused with a reason, and nothing is created', async () => {
  const s = await from.json('/api/styles', post({ name: 'Valid', description: 'valid', voice: VOICE }));
  const valid = await (await from.api(`/api/styles/${s.id}/export`)).json();
  const edit = (fn: (style: any) => void) => { const d = structuredClone(valid); fn(d.style); return JSON.stringify(d); };
  const before = (await to.json('/api/styles')).length;
  const cases: [string, number, RegExp][] = [
    ['not json', 400, /not a style export/],
    [JSON.stringify({ hello: 'world' }), 400, /not a style export/],
    [JSON.stringify({ ...valid, version: 99 }), 400, /newer version/],
    [edit((st) => { delete st.design; }), 400, /design/i],
    [edit((st) => { st.design = '# just a heading'; }), 400, /design/i],
    [edit((st) => { st.references = [{ kind: 'link', name: 'x', url: 'javascript:alert(1)' }]; }), 400, /http/],
    [edit((st) => { st.references = [{ kind: 'image', name: 'evil.png', ext: '.png', data: Buffer.from('<svg/>').toString('base64') }]; }), 415, /not a png image/],
  ];
  for (const [body, status, message] of cases) {
    const res = await importFile(to, body);
    assert.equal(res.status, status, `${body.slice(0, 60)} -> ${res.status}`);
    assert.match((await res.json()).error, message);
  }
  assert.equal((await to.json('/api/styles')).length, before);
});

test('importing is a mutation: it needs the app header', async () => {
  const res = await fetch(`${to.url}/api/styles/import`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: '{}' });
  assert.equal(res.status, 403);
});
