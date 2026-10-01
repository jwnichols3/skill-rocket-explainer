import { createFakeVideoRenderer } from '../../src/providers/fake/renderer.ts';
import { rendererContract } from '../contracts/renderer.ts';

rendererContract('fake', () => createFakeVideoRenderer(), { outputType: 'video', expectExt: ['.mp4'] });

// HyperFrames: live (real toolchain, Chrome, ffmpeg), opt-in with LIVE=1. The fake agent supplies scene
// code, so no model is needed. The toolchain cache defaults to a temp dir reused across runs.
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHyperFramesRenderer } from '../../src/providers/hyperframes/renderer.ts';
import { hyperframesCacheRoot } from '../../src/providers/hyperframes/checks.ts';
import { liveSkip } from '../contracts/live.ts';

const hyperframesHome = process.env.EXPLAINER_HOME ?? join(tmpdir(), 'rocket-explainer-live');
rendererContract('hyperframes', () => createHyperFramesRenderer({ cacheRoot: hyperframesCacheRoot(hyperframesHome) }),
  { outputType: 'video', expectExt: ['.mp4'], skip: liveSkip, timeout: 1_800_000 });
