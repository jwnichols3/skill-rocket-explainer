import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import type { Renderer, AgentSurface, ScenePlan, TimedScene } from '../../src/providers/types.ts';
import type { OutputType } from '../../src/settings.ts';
import { createFakeTts } from '../../src/providers/fake/tts.ts';
import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { narrateScenes } from '../../src/pipeline/narrate.ts';
import { designTemplate } from '../../src/style/design.ts';
import { probeDurationMs, probeStreams } from '../../src/media.ts';

export const CONTRACT_SCENES: ScenePlan[] = [
  { id: 's1', title: 'Opening', narration: 'Every message you send starts a journey.', visuals: 'A title card slams in with the words Packets Away', elements: ['opening', 'text-popups'] },
  { id: 's2', title: 'Packets', narration: 'It splits into packets, each in its own box.', visuals: 'One box splits into four labelled boxes', elements: ['boxes', 'transition'] },
  { id: 's3', title: 'Routers', narration: 'Routers pass them along a glowing map.', visuals: 'A three-node network diagram lights up as the camera pans', elements: ['diagram', 'camera'] },
];

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  '.pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
  '.png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  '.pptx': (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  '.html': (b) => /<html|<!doctype html/i.test(b.subarray(0, 2000).toString()),
  '.md': (b) => b.length > 0,
};

export async function timedScenes(dir: string): Promise<TimedScene[]> {
  return narrateScenes({ tts: createFakeTts(), voiceId: 'fake-bright', controls: {}, scenes: CONTRACT_SCENES, dir: join(dir, 'audio') });
}

/**
 * Shared renderer contract. `agent` defaults to the fake agent (canned scene code),
 * so a renderer's contract run needs its toolchain but no model.
 */
export function rendererContract(name: string, make: () => Renderer, opts: { outputType: OutputType; expectExt: string[]; agent?: () => AgentSurface; skip?: string | false; timeout?: number }) {
  const t = (title: string, fn: () => Promise<void>) => test(`[renderer contract: ${name} ${opts.outputType}] ${title}`, { skip: opts.skip, timeout: opts.timeout ?? 600_000 }, fn);
  const agent = () => ({ surface: (opts.agent ?? (() => createFakeAgent(() => ({}))))(), model: 'claude-opus-5-5', effort: 'high' });

  t('declares the output type', async () => {
    assert.ok(make().outputTypes.includes(opts.outputType));
  });

  t('output exists, has the right type, is non-empty, and matches the plan', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'renderer-contract-'));
    const scenes = await timedScenes(dir);
    const r = await make().render({ outputType: opts.outputType, style: designTemplate('neon blue/green, high contrast'), title: 'Contract', scenes, workdir: join(dir, 'render'), agent: agent(),
      document: '# Contract\n\nEvery message you send starts a journey.\n\n## Packets\n\nIt splits into packets.\n\n## Routers\n\nRouters pass them along.\n' });
    for (const ext of opts.expectExt) {
      const f = r.files.find((x) => extname(x) === ext);
      assert.ok(f, `no ${ext} output in ${r.files.join(', ')}`);
      assert.ok((await stat(f)).size > 0, `${f} is empty`);
      if (MAGIC[ext]) assert.ok(MAGIC[ext](await readFile(f)), `${f} is not a valid ${ext}`);
    }
    assert.equal(r.sceneCount, scenes.length);
    if (opts.outputType === 'video') {
      assert.deepEqual((await probeStreams(r.primary)).sort(), ['audio', 'video']);
      const expected = scenes.reduce((s, x) => s + x.durationMs, 0);
      const actual = await probeDurationMs(r.primary);
      assert.ok(Math.abs(actual - expected) <= Math.max(500, expected * 0.05), `video is ${actual}ms, time map says ${expected}ms`);
    }
  });

  if (opts.outputType === 'video') {
    t('re-renders only dirty scenes when given the previous render', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'renderer-contract-'));
      const scenes = await timedScenes(dir);
      const style = designTemplate('neon blue/green, high contrast');
      const first = await make().render({ outputType: 'video', style, title: 'Contract', scenes, workdir: join(dir, 'r1'), agent: agent() });
      assert.deepEqual(first.rendered.sort(), ['s1', 's2', 's3']);
      const second = await make().render({ outputType: 'video', style, title: 'Contract', scenes, workdir: join(dir, 'r2'), cacheDir: join(dir, 'r1'), dirtyScenes: ['s2'], agent: agent() });
      assert.deepEqual(second.rendered, ['s2']);
      const actual = await probeDurationMs(second.primary);
      const expected = scenes.reduce((s, x) => s + x.durationMs, 0);
      assert.ok(Math.abs(actual - expected) <= Math.max(500, expected * 0.05));
    });
  }
}
