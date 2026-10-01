import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TtsProvider, ScenePlan, TimedScene, VoiceControls } from '../providers/types.ts';

/** Silence after each scene's narration so cuts don't clip the last word. */
export const SCENE_TAIL_MS = 350;

/**
 * Narrates each scene to its own clip and lays the scenes end to end: the scene time map.
 * Scenes in `reuse` (by id, unchanged narration) keep their previous audio.
 */
export async function narrateScenes(opts: {
  tts: TtsProvider;
  voiceId: string;
  controls: VoiceControls;
  scenes: ScenePlan[];
  dir: string;
  reuse?: Map<string, TimedScene>;
  onScene?: (i: number, scene: ScenePlan, reused: boolean) => void;
  signal?: AbortSignal;
}): Promise<TimedScene[]> {
  await mkdir(opts.dir, { recursive: true });
  const out: TimedScene[] = [];
  let t = 0;
  for (const [i, scene] of opts.scenes.entries()) {
    if (opts.signal?.aborted) throw new Error('cancelled');
    const prev = opts.reuse?.get(scene.id);
    let timed: TimedScene;
    if (prev && prev.narration === scene.narration && prev.audioFile) {
      opts.onScene?.(i, scene, true);
      timed = { ...scene, audioFile: prev.audioFile, durationMs: prev.durationMs, words: prev.words, startMs: t };
    } else {
      opts.onScene?.(i, scene, false);
      const n = await opts.tts.synthesize(scene.narration, opts.voiceId, opts.controls, join(opts.dir, `${scene.id}.wav`));
      timed = { ...scene, audioFile: n.audioFile, durationMs: n.durationMs + SCENE_TAIL_MS, words: n.words, startMs: t };
    }
    out.push(timed);
    t += timed.durationMs;
  }
  return out;
}
