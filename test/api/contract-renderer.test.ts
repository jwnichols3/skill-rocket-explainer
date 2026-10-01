import { createFakeVideoRenderer } from '../../src/providers/fake/renderer.ts';
import { rendererContract } from '../contracts/renderer.ts';

rendererContract('fake', () => createFakeVideoRenderer(), { outputType: 'video', expectExt: ['.mp4'] });

// Remotion: real toolchain, fake agent supplying scene code. Opt-in (LIVE=1): installs Remotion once into a
// shared cache (EXPLAINER_REMOTION_CACHE or the OS temp dir), then renders at 1920x1080.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRemotionRenderer } from '../../src/providers/remotion/renderer.ts';
import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import { designTemplate } from '../../src/style/design.ts';
import { probeDurationMs } from '../../src/media.ts';
import { liveSkip } from '../contracts/live.ts';
import { timedScenes } from '../contracts/renderer.ts';

const remotionCache = process.env.EXPLAINER_REMOTION_CACHE ?? join(tmpdir(), 'rocket-explainer-remotion-cache');
const remotion = () => createRemotionRenderer({ projectDir: remotionCache });
rendererContract('remotion', remotion, { outputType: 'video', expectExt: ['.mp4'], skip: liveSkip, timeout: 1_200_000 });

test('[remotion] a scene whose code fails to compile is retried once with the error', { skip: liveSkip, timeout: 1_200_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remotion-retry-'));
  const scenes = (await timedScenes(dir)).slice(0, 2);
  scenes[1] = { ...scenes[1], visuals: `${scenes[1].visuals} [fake: broken once]` };
  const logs: string[] = [];
  const r = await remotion().render({ outputType: 'video', style: designTemplate('neon'), title: 'Retry', scenes, workdir: join(dir, 'render'),
    agent: { surface: createFakeAgent(() => ({})), model: 'claude-opus-5-5', effort: 'high' }, onLog: (l) => logs.push(l) });
  assert.deepEqual(r.rendered.sort(), ['s1', 's2']);
  assert.ok(logs.some((l) => l.includes('writing scene s2 (attempt 2')), logs.join('\n'));
  const expected = scenes.reduce((s, x) => s + x.durationMs, 0);
  assert.ok(Math.abs(await probeDurationMs(r.primary) - expected) <= 500);
});
// HyperFrames: live (real toolchain, Chrome, ffmpeg), opt-in with LIVE=1. The fake agent supplies scene
// code, so no model is needed. The toolchain cache defaults to a temp dir reused across runs.
import { createHyperFramesRenderer } from '../../src/providers/hyperframes/renderer.ts';
import { hyperframesCacheRoot } from '../../src/providers/hyperframes/checks.ts';

const hyperframesHome = process.env.EXPLAINER_HOME ?? join(tmpdir(), 'rocket-explainer-live');
rendererContract('hyperframes', () => createHyperFramesRenderer({ cacheRoot: hyperframesCacheRoot(hyperframesHome) }),
  { outputType: 'video', expectExt: ['.mp4'], skip: liveSkip, timeout: 1_800_000 });

import { createFakeDocumentRenderer } from '../../src/providers/fake/renderer.ts';
rendererContract('fake', () => createFakeDocumentRenderer(), { outputType: 'deck', expectExt: ['.html', '.pptx'] });
rendererContract('fake', () => createFakeDocumentRenderer(), { outputType: 'doc', expectExt: ['.pdf', '.md'] });
rendererContract('fake', () => createFakeDocumentRenderer(), { outputType: 'visual', expectExt: ['.png', '.html'] });

// One-pager visual: real headless Chromium capture, fake agent supplying the page. Runs by default, like the browser test.
import { createVisualRenderer } from '../../src/providers/visual/renderer.ts';
rendererContract('html-visual', () => createVisualRenderer(), { outputType: 'visual', expectExt: ['.png', '.html', '.json'] });
