import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp, waitForJob, post, put, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const VOICE = { provider: 'fake', voiceId: 'fake-bright', controls: {} };

async function styleWithSample(body: Record<string, unknown> = {}) {
  const style = await app.json('/api/styles', post({ description: 'neon blue/green, high contrast', voice: VOICE, ...body }));
  const job = await waitForJob(app, (await app.json(`/api/styles/${style.id}/sample`, post({}))).id);
  assert.equal(job.status, 'succeeded', job.error);
  return style.id as string;
}

async function rerender(id: string, body: Record<string, unknown> = {}) {
  const job = await waitForJob(app, (await app.json(`/api/styles/${id}/rerender`, post(body))).id);
  assert.equal(job.status, 'succeeded', job.error);
  return app.json(`/api/styles/${id}`);
}

const design = async (url: string) => (await app.api(url)).text();

test('comments (optionally timestamped) attach to a round; re-render applies them in a new round', async () => {
  const id = await styleWithSample();
  const c1 = await app.json(`/api/styles/${id}/rounds/1/comments`, post({ text: 'contrast too low', atMs: 2300 }));
  assert.equal(c1.atMs, 2300);
  await app.json(`/api/styles/${id}/rounds/1/comments`, post({ text: 'voice is too slow' }));
  const s = await rerender(id);
  assert.equal(s.rounds.length, 2);
  assert.equal(s.currentRound, 2);
  assert.equal(s.rounds[0].comments.length, 2);
  assert.equal(s.rounds[1].basedOn, 1);
  const d2 = await design(s.rounds[1].designUrl);
  assert.match(d2, /contrast too low/);
  assert.match(d2, /voice is too slow/);
  assert.doesNotMatch(await design(s.rounds[0].designUrl), /contrast too low/);
});

test('comments can be removed before re-rendering', async () => {
  const id = await styleWithSample();
  const c = await app.json(`/api/styles/${id}/rounds/1/comments`, post({ text: 'oops' }));
  await app.json(`/api/styles/${id}/rounds/1/comments/${c.id}`, { method: 'DELETE' });
  const s = await app.json(`/api/styles/${id}`);
  assert.equal(s.rounds[0].comments.length, 0);
});

test('voice and model changes apply to the next round', async () => {
  const id = await styleWithSample();
  await app.json(`/api/styles/${id}`, put({ voice: { provider: 'fake', voiceId: 'fake-deep', controls: { rate: 90 } }, model: 'claude-fable-5-1', effort: 'max' }));
  const s = await rerender(id);
  assert.equal(s.rounds[0].model, 'claude-opus-5-5');
  assert.equal(s.rounds[1].model, 'claude-fable-5-1');
  assert.equal(s.rounds[1].effort, 'max');
  assert.equal(s.rounds[1].voice.voiceId, 'fake-deep');
});

test('revert makes an earlier round current without deleting later ones; the next round builds on it', async () => {
  const id = await styleWithSample();
  await app.json(`/api/styles/${id}/rounds/1/comments`, post({ text: 'make it purple' }));
  await rerender(id);
  const reverted = await app.json(`/api/styles/${id}/revert`, post({ round: 1 }));
  assert.equal(reverted.currentRound, 1);
  assert.equal(reverted.rounds.length, 2);
  assert.doesNotMatch(reverted.design, /make it purple/);
  const s = await rerender(id);
  assert.equal(s.rounds.length, 3);
  assert.equal(s.rounds[2].basedOn, 1);
});

test('saving an unnamed style offers 2-3 suggested names; a chosen name is kept', async () => {
  const id = await styleWithSample();
  const { names } = await app.json(`/api/styles/${id}/name-suggestions`, post({}));
  assert.ok(names.length >= 2 && names.length <= 3, JSON.stringify(names));
  const saved = await app.json(`/api/styles/${id}/save`, post({ name: names[1] }));
  assert.equal(saved.name, names[1]);
  assert.ok(saved.savedAt);
  const named = await app.json('/api/styles', post({ name: 'Up Front', description: 'x', voice: VOICE }));
  assert.equal((await app.json(`/api/styles/${named.id}/save`, post({}))).name, 'Up Front');
});

test('clone is an independent, editable copy', async () => {
  const id = await styleWithSample({ name: 'Original' });
  const clone = await app.json(`/api/styles/${id}/clone`, post({}));
  assert.notEqual(clone.id, id);
  assert.equal(clone.name, 'Original copy');
  assert.equal(clone.clonedFrom, id);
  assert.equal(clone.rounds.length, 1);
  await app.json(`/api/styles/${clone.id}/rounds/1/comments`, post({ text: 'calmer voice' }));
  await rerender(clone.id);
  const original = await app.json(`/api/styles/${id}`);
  assert.equal(original.rounds.length, 1);
  assert.equal(original.rounds[0].comments.length, 0);
  assert.doesNotMatch(original.design, /calmer voice/);
});

test('delete removes a style; it warns first when explainers use it', async () => {
  const unused = await styleWithSample();
  await app.json(`/api/styles/${unused}`, { method: 'DELETE' });
  assert.equal((await app.api(`/api/styles/${unused}`)).status, 404);

  const used = await styleWithSample({ name: 'Busy' });
  const ex = join(app.home, 'explainers', 'ex_test');
  await mkdir(ex, { recursive: true });
  await writeFile(join(ex, 'explainer.json'), JSON.stringify({ id: 'ex_test', title: 'Uses Busy', styleId: used }));
  const blocked = await app.api(`/api/styles/${used}`, { method: 'DELETE' });
  assert.equal(blocked.status, 409);
  const body = await blocked.json();
  assert.deepEqual(body.usedBy.map((e: any) => e.title), ['Uses Busy']);
  await app.json(`/api/styles/${used}?force=1`, { method: 'DELETE' });
  assert.equal((await app.api(`/api/styles/${used}`)).status, 404);
});
