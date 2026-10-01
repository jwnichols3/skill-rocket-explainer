import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, waitForJob, post } from '../helpers/app.ts';
import { makeReferenceMedia } from '../helpers/media.ts';
import { validateDesign } from '../../src/style/design.ts';
import { liveSkip } from '../contracts/live.ts';

// Real Claude Code on the logged-in subscription reading generated frames. Opt-in: LIVE=1. A cheap model at low effort.
const MODEL = 'claude-haiku-4-5-20251001';

test('live: reference video -> instructions and a valid DESIGN.md; suggestions', { skip: liveSkip, timeout: 600_000 }, async () => {
  const app = await startTestApp({ providers: { agent: 'claude-subscription' } });
  const media = await mkdtemp(join(tmpdir(), 'explainer-live-media-'));
  try {
    await makeReferenceMedia(media);
    const { suggestions } = await app.json('/api/styles/suggest', post({ description: 'test-card explainer, broadcast engineering vibe', model: MODEL }));
    assert.ok(suggestions.length >= 3 && suggestions.length <= 6, JSON.stringify(suggestions));

    const s = await app.json('/api/styles', post({ description: 'test-card explainer', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} }, model: MODEL, effort: 'low' }));
    const ref = await app.json(`/api/styles/${s.id}/references?name=clip.mp4`, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: await readFile(join(media, 'clip.mp4')) });
    const job = await waitForJob(app, (await app.json(`/api/styles/${s.id}/references/${ref.id}/analyze`, post({}))).id, 540_000);
    assert.equal(job.status, 'succeeded', `${job.error}\n${job.log.slice(-20).join('\n')}`);
    assert.ok(job.log.some((l: string) => /claude: Read \S*frames\/f\d+\.jpg/.test(l)), `the agent did not read the frames:\n${job.log.join('\n')}`);
    const view = await app.json(`/api/styles/${s.id}`);
    assert.match(view.description, /From the reference video "clip.mp4":\n- /);
    if (job.result.designUpdated) assert.deepEqual(validateDesign(view.design), []);
  } finally {
    await app.stop();
    await rm(media, { recursive: true, force: true });
  }
});
