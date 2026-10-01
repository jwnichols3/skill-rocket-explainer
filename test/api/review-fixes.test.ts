import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp, waitForJob, approvedExplainer, post, put, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('agent-written HTML under /media is served sandboxed with no network', async () => {
  const { id } = await approvedExplainer(app, 'deck');
  await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/deck/build`, post({}))).id);
  const e = await app.json(`/api/explainers/${id}`);
  const res = await app.api(e.outputs.deck.rounds[0].url);
  assert.match(res.headers.get('content-security-policy') ?? '', /sandbox/);
  assert.match(res.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
});

test("a sandboxed page's requests (Origin: null) are refused", async () => {
  const res = await app.api('/api/settings', { method: 'PUT', body: '{}', headers: { origin: 'null' } });
  assert.equal(res.status, 403);
});

test('stray files in the styles and explainers folders do not break listing', async () => {
  await writeFile(join(app.home, 'explainers', '.DS_Store'), 'x');
  await writeFile(join(app.home, 'styles', '.DS_Store'), 'x');
  assert.ok(Array.isArray(await app.json('/api/explainers')));
  assert.ok(Array.isArray(await app.json('/api/styles')));
});

test('settings refuse a non-loopback bind, a bad port, malformed hostnames and inherited provider names', async () => {
  for (const body of [{ host: '0.0.0.0' }, { port: 99999 }, { publicHostnames: 5 }, { providers: { agent: 'constructor' } }]) {
    const r = await app.api('/api/settings', put(body));
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal((await app.json('/api/status')).app, 'rocket-explainer');
});

test('script edits are refused while a job runs on the explainer', async () => {
  const { id } = await approvedExplainer(app);
  await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  await app.json('/api/settings', put({ fake: { delayMs: 800 } }));
  try {
    await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'x', sceneId: 's1' }));
    const job = await app.json(`/api/explainers/${id}/outputs/video/rerender`, post({}));
    const r = await app.api(`/api/explainers/${id}/outputs/video/script`, put({ scenes: [{ id: 's1', narration: 'edited' }] }));
    assert.equal(r.status, 409);
    await waitForJob(app, job.id);
  } finally {
    await app.json('/api/settings', put({ fake: { delayMs: 0 } }));
  }
});

test('re-render works while a revised plan awaits approval, and reused scenes keep word timings', async () => {
  const { id } = await approvedExplainer(app);
  await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/build`, post({}))).id);
  await waitForJob(app, (await app.json(`/api/explainers/${id}/plan`, post({}))).id);
  assert.equal((await app.json(`/api/explainers/${id}`)).approvedPlan, null);
  await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'brighter', sceneId: 's2' }));
  const j = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/video/rerender`, post({}))).id);
  assert.equal(j.status, 'succeeded', j.error);
  const { readFile } = await import('node:fs/promises');
  const timeline = JSON.parse(await readFile(join(app.home, 'explainers', id, 'outputs', 'video', 'rounds', '2', 'timeline.json'), 'utf8'));
  assert.ok(timeline.every((s: any) => s.words.length > 0), 'a reused scene lost its word timings');
});
