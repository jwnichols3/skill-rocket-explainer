import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, waitForJob, approvedExplainer, post, put, type TestApp } from '../helpers/app.ts';
import { ttsCostUsd } from '../../src/usage.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const run = async (path: string) => waitForJob(app, (await app.json(path, post({}))).id);

test('each explainer job records its agent and narration usage, with totals', async () => {
  const { id } = await approvedExplainer(app);
  const build = await run(`/api/explainers/${id}/outputs/video/build`);
  assert.equal(build.status, 'succeeded', build.error);
  const e = await app.json(`/api/explainers/${id}`);

  assert.deepEqual(e.usage.entries.map((u: any) => u.kind), ['source-report', 'plan', 'build-video']);
  for (const u of e.usage.entries) {
    assert.equal(u.status, 'succeeded');
    assert.ok(u.agentRuns >= 1, `${u.kind} ran no agent`);
    assert.ok(u.inputTokens > 0 && u.outputTokens > 0, `${u.kind} has no tokens`);
  }
  // Narration: every character of the built script, once.
  const narration = e.outputs.video.rounds[0].scenes.reduce((n: number, s: any) => n + s.narration.length, 0);
  const b = e.usage.entries[2];
  assert.equal(b.ttsChars, narration);
  assert.equal(e.usage.entries[0].ttsChars, 0);

  const sum = (k: string) => e.usage.entries.reduce((n: number, u: any) => n + u[k], 0);
  assert.equal(e.usage.totals.inputTokens, sum('inputTokens'));
  assert.equal(e.usage.totals.outputTokens, sum('outputTokens'));
  assert.ok(Math.abs(e.usage.totals.costUsd - sum('costUsd')) < 1e-9);
  assert.ok(e.usage.totals.costUsd > 0);
});

test('a re-render that reuses narration is not charged for it again', async () => {
  const { id } = await approvedExplainer(app);
  assert.equal((await run(`/api/explainers/${id}/outputs/video/build`)).status, 'succeeded');
  await app.json(`/api/explainers/${id}/outputs/video/rounds/1/comments`, post({ text: 'make the arrow green', sceneId: 's2' }));
  const r = await run(`/api/explainers/${id}/outputs/video/rerender`);
  assert.equal(r.status, 'succeeded', r.error);
  const e = await app.json(`/api/explainers/${id}`);
  const rerender = e.usage.entries.at(-1);
  assert.equal(rerender.kind, 'rerender-video');
  assert.equal(rerender.ttsChars, 0);
  assert.equal(rerender.agentRuns, 1);
});

test('a failed job still records what it spent', async () => {
  const style = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const e = await app.json('/api/explainers', post({ brief: 'x', sources: [{ kind: 'note', value: 'y' }], styleId: style.id }));
  assert.equal((await run(`/api/explainers/${e.id}/report`)).status, 'succeeded');
  await app.json('/api/settings', put({ fake: { failKinds: ['explainer-plan'] } }));
  try {
    assert.equal((await run(`/api/explainers/${e.id}/plan`)).status, 'failed');
  } finally {
    await app.json('/api/settings', put({ fake: { failKinds: [] } }));
  }
  const x = await app.json(`/api/explainers/${e.id}`);
  const plan = x.usage.entries.at(-1);
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.status, 'failed');
  assert.equal(plan.agentRuns, 1);
});

test('style sample rounds record usage on the style', async () => {
  const style = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const job = await run(`/api/styles/${style.id}/sample`);
  assert.equal(job.status, 'succeeded', job.error);
  const s = await app.json(`/api/styles/${style.id}`);
  assert.equal(s.usage.entries.length, 1);
  assert.ok(s.usage.entries[0].agentRuns >= 1);
  assert.ok(s.usage.totals.costUsd > 0);
});

test('Polly narration is estimated at list price, counting the speech-marks request', () => {
  // aws.amazon.com/polly/pricing (2026-10-01): per 1M characters, speech and speech marks each billed.
  assert.equal(ttsCostUsd('polly', 'Brian:generative', 1_000_000), 30);
  assert.equal(ttsCostUsd('polly', 'Joanna:neural', 1_000_000), 32);
  assert.equal(ttsCostUsd('polly', 'Joanna:standard', 1_000_000), 8);
  assert.equal(ttsCostUsd('polly', 'Danielle:long-form', 1_000_000), 200);
  assert.equal(ttsCostUsd('kokoro', 'af_heart', 1_000_000), 0);
  // Plan-dependent: characters are shown, the price is unknown.
  assert.equal(ttsCostUsd('elevenlabs', 'JBFqnCBsd6RMkjVDRZzv', 1_000_000), null);
});
