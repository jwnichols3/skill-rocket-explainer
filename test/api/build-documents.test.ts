import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, waitForJob, approvedExplainer, post, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const EXPECT: Record<string, { files: string[]; type: RegExp }> = {
  deck: { files: ['deck.html', 'deck.pptx'], type: /text\/html/ },
  doc: { files: ['doc.pdf', 'doc.md'], type: /application\/pdf/ },
  visual: { files: ['visual.png', 'visual.html'], type: /image\/png/ },
};

for (const [type, want] of Object.entries(EXPECT)) {
  test(`${type}: build produces ${want.files.join(' + ')}; a scene-pinned comment re-renders`, async () => {
    const { id } = await approvedExplainer(app, type);
    const j = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/${type}/build`, post({}))).id);
    assert.equal(j.status, 'succeeded', j.error);
    let e = await app.json(`/api/explainers/${id}`);
    const r = e.outputs[type].rounds[0];
    assert.deepEqual(r.files, want.files);
    const res = await app.api(r.url);
    assert.match(res.headers.get('content-type') ?? '', want.type);
    await app.json(`/api/explainers/${id}/outputs/${type}/rounds/1/comments`, post({ text: 'tighter', sceneId: 's2' }));
    const j2 = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/${type}/rerender`, post({}))).id);
    assert.equal(j2.status, 'succeeded', j2.error);
    e = await app.json(`/api/explainers/${id}`);
    assert.match(e.outputs[type].rounds[1].scenes[1].visuals, /tighter/);
  });

  test(`${type}: a style renders an on-demand ${type} sample in the same round history`, async () => {
    const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
    await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
    const j = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({ outputType: type }))).id);
    assert.equal(j.status, 'succeeded', j.error);
    let style = await app.json(`/api/styles/${s.id}`);
    assert.deepEqual(style.rounds.map((r: any) => r.outputType), ['video', type]);
    assert.equal(style.currentRound, 2);
    assert.match(style.rounds[1].sampleUrl, new RegExp(`sample\\.${want.files[0].split('.')[1]}$`));
    // Comment and re-render stay in that type.
    await app.json(`/api/styles/${s.id}/rounds/2/comments`, post({ text: 'bigger titles' }));
    await waitForJob(app, (await app.json(`/api/styles/${s.id}/rerender`, post({}))).id);
    style = await app.json(`/api/styles/${s.id}`);
    assert.equal(style.rounds[2].outputType, type);
    assert.match(style.design, /bigger titles/);
  });
}
