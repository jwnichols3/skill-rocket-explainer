import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startTestApp, waitForJob, post, put, type TestApp } from '../helpers/app.ts';

let app: TestApp;
let srcDir: string;
before(async () => {
  app = await startTestApp();
  srcDir = await mkdtemp(join(tmpdir(), 'explainer-sources-'));
  await writeFile(join(srcDir, 'meeting-notes.md'), '# Options call\n\nOption A: queue. Option B: stream.\n');
});
after(async () => { await app.stop(); });

async function newExplainer(extra: Record<string, unknown> = {}) {
  return app.json('/api/explainers', post({
    brief: 'the options discussed on this call',
    sources: [{ kind: 'path', value: join(srcDir, 'meeting-notes.md') }, { kind: 'path', value: join(srcDir, 'missing.md') }],
    ...extra,
  }));
}

async function report(id: string) {
  const job = await waitForJob(app, (await app.json(`/api/explainers/${id}/report`, post({}))).id);
  assert.equal(job.status, 'succeeded', job.error);
  return app.json(`/api/explainers/${id}`);
}

test('an explainer is created with sources and a brief, defaults to Opus 5.5 high, and is listed', async () => {
  const e = await newExplainer({ title: 'Options call' });
  assert.equal(e.title, 'Options call');
  assert.equal(e.model, 'claude-opus-5-5');
  assert.equal(e.effort, 'high');
  assert.equal(e.status, 'draft');
  assert.equal(e.sources.length, 2);
  assert.ok(e.sources.every((s: any) => s.id && s.enabled));
  const list = await app.json('/api/explainers');
  assert.ok(list.some((x: any) => x.id === e.id));
});

test('the source report says what was found and what was not, with an expandable extract', async () => {
  const e = await newExplainer();
  const r = await report(e.id);
  assert.equal(r.status, 'reported');
  const [found, missing] = e.sources.map((s: any) => r.report.sources.find((x: any) => x.sourceId === s.id));
  assert.equal(found.found, true);
  assert.ok(found.summary.length > 0);
  assert.ok(found.extract.length > 0);
  assert.equal(missing.found, false);
  assert.ok(r.report.overall.length > 0);
});

test('steering edits sources and corrections, and re-running the report reflects them', async () => {
  const e = await newExplainer();
  await report(e.id);
  const extra = join(srcDir, 'extra.md');
  await writeFile(extra, 'Option C: batch.');
  const sources = [{ ...e.sources[0] }, { ...e.sources[1], enabled: false }, { kind: 'path', value: extra }];
  await app.json(`/api/explainers/${e.id}`, put({ sources }));
  await app.json(`/api/explainers/${e.id}/corrections`, post({ text: 'Option B is Kafka, not Kinesis' }));
  const r = await report(e.id);
  assert.equal(r.sources.length, 3);
  assert.equal(r.report.sources.length, 2, 'disabled source is not gathered');
  assert.ok(r.report.sources.some((s: any) => s.sourceId === r.sources[2].id && s.found));
  assert.match(r.report.overall, /Kafka, not Kinesis/);
});

test('style, output type, model and effort choices persist; bad choices are refused', async () => {
  const style = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const e = await newExplainer();
  const updated = await app.json(`/api/explainers/${e.id}`, put({ styleId: style.id, outputType: 'deck', model: 'claude-fable-5-1', effort: 'max' }));
  assert.deepEqual([updated.styleId, updated.outputType, updated.model, updated.effort], [style.id, 'deck', 'claude-fable-5-1', 'max']);
  assert.equal((await app.api(`/api/explainers/${e.id}`, put({ outputType: 'hologram' }))).status, 400);
  assert.equal((await app.api(`/api/explainers/${e.id}`, put({ styleId: 'st_nope' }))).status, 400);
});

test('the plan can be commented on and regenerated, and approval is explicit', async () => {
  const style = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const e = await newExplainer();
  assert.equal((await app.api(`/api/explainers/${e.id}/approve`, post({}))).status, 400, 'no plan yet');
  await report(e.id);
  await app.json(`/api/explainers/${e.id}`, put({ styleId: style.id, outputType: 'video' }));

  const j1 = await waitForJob(app, (await app.json(`/api/explainers/${e.id}/plan`, post({}))).id);
  assert.equal(j1.status, 'succeeded', j1.error);
  let x = await app.json(`/api/explainers/${e.id}`);
  assert.equal(x.status, 'planned');
  const p1 = x.plans.at(-1);
  assert.ok(p1.plan.outline.length > 0);
  assert.ok(p1.plan.scenes.length > 0 && p1.plan.scenes.every((s: any) => s.id && s.visuals));
  assert.ok(p1.plan.keyVisuals.length > 0);
  assert.ok(p1.plan.length);

  await app.json(`/api/explainers/${e.id}/plans/${p1.n}/comments`, post({ text: 'lead with the cost comparison' }));
  const j2 = await waitForJob(app, (await app.json(`/api/explainers/${e.id}/plan`, post({}))).id);
  assert.equal(j2.status, 'succeeded', j2.error);
  x = await app.json(`/api/explainers/${e.id}`);
  assert.equal(x.plans.length, 2);
  assert.match(JSON.stringify(x.plans[1].plan), /lead with the cost comparison/);

  const approved = await app.json(`/api/explainers/${e.id}/approve`, post({}));
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedPlan, 2);
});

test('path completion helps pick sources in the browser', async () => {
  const r = await app.json(`/api/fs/complete?prefix=${encodeURIComponent(join(srcDir, 'mee'))}`);
  assert.deepEqual(r.map((x: any) => x.path), [join(srcDir, 'meeting-notes.md')]);
});
