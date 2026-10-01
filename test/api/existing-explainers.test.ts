import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp, waitForJob, approvedExplainer, post, put, type TestApp } from '../helpers/app.ts';
import { startServer } from '../../src/server.ts';

const apps: TestApp[] = [];
after(async () => { for (const a of apps) await a.stop(); });
async function app() { const a = await startTestApp(); apps.push(a); return a; }
async function ok(a: TestApp, jobId: string) { const j = await waitForJob(a, jobId); assert.equal(j.status, 'succeeded', j.error); return j; }

test('the list shows title, style, output types, status and last updated', async () => {
  const a = await app();
  const { id, styleId } = await approvedExplainer(a);
  await ok(a, (await a.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  const [row] = await a.json('/api/explainers');
  assert.equal(row.id, id);
  assert.equal(row.title, 'Fake explainer');
  assert.equal(row.styleId, styleId);
  assert.deepEqual(row.outputTypes, ['video']);
  assert.equal(row.status, 'built');
  assert.ok(row.updatedAt);
});

test('reopening after an app restart restores full state and iteration continues from the latest round', async () => {
  const a = await app();
  const { id } = await approvedExplainer(a);
  await ok(a, (await a.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  await a.close();
  const b = await startServer({ home: a.home, port: 0 });
  try {
    const call = (path: string, init: RequestInit = {}) => fetch(b.url + path, { ...init, headers: { 'x-explainer': '1', 'content-type': 'application/json' } }).then((r) => r.json());
    const e = await call(`/api/explainers/${id}`);
    assert.equal(e.outputs.video.rounds.length, 1);
    assert.equal(e.approvedPlan, 1);
    await call(`/api/explainers/${id}/outputs/video/rounds/1/comments`, { method: 'POST', body: JSON.stringify({ text: 'more upbeat', sceneId: 's1' }) });
    const job = await call(`/api/explainers/${id}/outputs/video/rerender`, { method: 'POST', body: '{}' });
    let j = job;
    while (j.status === 'queued' || j.status === 'running') { await new Promise((r) => setTimeout(r, 100)); j = await call(`/api/jobs/${job.id}`); }
    assert.equal(j.status, 'succeeded', j.error);
    const after = await call(`/api/explainers/${id}`);
    assert.equal(after.outputs.video.rounds.length, 2);
    assert.equal(after.outputs.video.rounds[1].basedOn, 1);
  } finally {
    await b.close();
  }
});

test('delete removes the explainer and its files', async () => {
  const a = await app();
  const { id } = await approvedExplainer(a);
  await a.json(`/api/explainers/${id}`, { method: 'DELETE' });
  assert.equal((await a.api(`/api/explainers/${id}`)).status, 404);
  await assert.rejects(access(join(a.home, 'explainers', id)));
});

test('adding an output type reuses the sources and report; each type keeps its own plan', async () => {
  const a = await app();
  const { id } = await approvedExplainer(a);
  await ok(a, (await a.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  const before = await a.json(`/api/explainers/${id}`);

  await a.json(`/api/explainers/${id}`, put({ outputType: 'deck' }));
  let e = await a.json(`/api/explainers/${id}`);
  assert.equal(e.approvedPlan, null, 'no deck plan approved yet');
  await ok(a, (await a.json(`/api/explainers/${id}/plan`, post({}))).id);
  e = await a.json(`/api/explainers/${id}`);
  assert.equal(e.report.createdAt, before.report.createdAt, 'report reused, not re-gathered');
  const deckPlan = e.plans.at(-1);
  assert.equal(deckPlan.outputType, 'deck');
  assert.match(deckPlan.plan.scenes[0].title, /Slide/);
  await a.json(`/api/explainers/${id}/approve`, post({}));

  // The video still re-renders against its own plan.
  await a.json(`/api/explainers/${id}`, put({ outputType: 'video' }));
  e = await a.json(`/api/explainers/${id}`);
  assert.equal(e.approvedPlan, 1);
  assert.equal(e.plans.find((p: any) => p.n === e.approvedPlan).outputType, 'video');
});
