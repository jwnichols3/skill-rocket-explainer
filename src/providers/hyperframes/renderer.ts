import { access, copyFile, cp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Renderer, RenderRequest, RenderResult, TimedScene } from '../types.ts';
import { exec, ffmpeg, probeDurationMs } from '../../media.ts';
import { ensureToolchain, hyperframesEnv, type Toolchain } from './toolchain.ts';
import { scenePrompt, SCENE_FILE } from './prompt.ts';

export const WIDTH = 1920;
export const HEIGHT = 1080;
export const FPS = 30;
const SCENE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'];
const RENDER_TIMEOUT_MS = 15 * 60_000;

const exists = (f: string) => access(f).then(() => true, () => false);
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const tail = (s: string, n = 3000) => strip(s).trim().slice(-n);

/** Composition ids double as JS keys and CSS-ish ids; keep them simple. */
export function compositionId(sceneId: string): string {
  return `scene-${sceneId.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

export interface HyperFramesOptions {
  /** Shared toolchain cache, e.g. <home>/cache/hyperframes. */
  cacheRoot: string;
}

/**
 * Video renderer on HeyGen's HyperFrames (Apache-2.0). Per dirty scene an agent writes one
 * HTML/GSAP composition (guided by HyperFrames' own skills), the HyperFrames CLI renders it,
 * ffmpeg muxes the scene's narration and normalizes the clip; clean scenes are reused from
 * cacheDir; clips are concatenated into output.mp4.
 */
export function createHyperFramesRenderer(opts: HyperFramesOptions): Renderer {
  return {
    id: 'hyperframes',
    label: 'HyperFrames (HTML + GSAP)',
    outputTypes: ['video'],
    async render(req: RenderRequest): Promise<RenderResult> {
      if (req.outputType !== 'video') throw new Error(`HyperFrames renders video, not ${req.outputType}`);
      await mkdir(req.workdir, { recursive: true });
      const log = (l: string) => req.onLog?.(l);
      let toolchain: Toolchain | null = null;
      const rendered: string[] = [];
      const clips: string[] = [];
      for (const scene of req.scenes) {
        const clip = join(req.workdir, `scene-${scene.id}.mp4`);
        const cached = req.cacheDir ? join(req.cacheDir, `scene-${scene.id}.mp4`) : '';
        const dirty = !req.dirtyScenes || req.dirtyScenes.includes(scene.id);
        if (!dirty && cached && await exists(cached)) {
          if (cached !== clip) await copyFile(cached, clip);
          log(`reused scene ${scene.id} from cache`);
        } else {
          toolchain ??= await ensureToolchain(opts.cacheRoot, log);
          req.onScene?.(scene.id, req.scenes.indexOf(scene), req.scenes.length);
          await renderScene(toolchain, req, scene, clip);
          rendered.push(scene.id);
        }
        clips.push(clip);
      }
      const list = join(req.workdir, 'concat.txt');
      await writeFile(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
      const out = join(req.workdir, 'output.mp4');
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal: req.signal });
      return { primary: out, files: [out], durationMs: await probeDurationMs(out), sceneCount: req.scenes.length, rendered };
    },
  };
}

/** One scene: agent writes the composition, we lint + render it; one retry with the error fed back. */
async function renderScene(tc: Toolchain, req: RenderRequest, scene: TimedScene, clip: string): Promise<void> {
  if (!req.agent) throw new Error('the HyperFrames renderer needs an agent to write scene compositions');
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    try {
      const project = join(req.workdir, 'scenes', scene.id, `attempt-${attempt}`);
      await prepareProject(tc, project, req.style);
      const previousFile = join(req.workdir, 'scenes', scene.id, `attempt-${attempt - 1}`, SCENE_FILE);
      if (previousError && await exists(previousFile)) await copyFile(previousFile, join(project, 'previous-attempt.html.txt'));
      await writeScene(req, scene, project, previousError);
      const raw = join(req.workdir, 'scenes', scene.id, `attempt-${attempt}.raw.mp4`);
      await renderComposition(tc, project, raw, req);
      await muxScene(raw, scene, clip, req.signal);
      req.onLog?.(`rendered scene ${scene.id} (${(scene.durationMs / 1000).toFixed(2)}s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      return;
    } catch (err: any) {
      if (req.signal?.aborted) throw err;
      previousError = String(err?.message ?? err);
      const lines = previousError.split('\n');
      req.onLog?.(`scene ${scene.id} attempt ${attempt} failed: ${lines[0]} ${lines.find((l) => /✗|error/i.test(l))?.trim() ?? ''}`);
      if (attempt === 2) throw new Error(`HyperFrames could not render scene "${scene.id}" (${scene.title}) after a retry: ${previousError}`);
    }
  }
}

/** A per-scene HyperFrames project: the style, local GSAP and HyperFrames' skills where `claude -p` finds them. */
async function prepareProject(tc: Toolchain, dir: string, style: string): Promise<void> {
  await mkdir(join(dir, '.claude'), { recursive: true });
  await cp(tc.skillsDir, join(dir, '.claude', 'skills'), { recursive: true });
  await copyFile(tc.gsap, join(dir, 'gsap.min.js'));
  await writeFile(join(dir, 'DESIGN.md'), style);
}

async function writeScene(req: RenderRequest, scene: TimedScene, dir: string, previousError?: string): Promise<void> {
  const agent = req.agent!;
  const res = await agent.surface.run({
    kind: 'hyperframes-scene',
    prompt: scenePrompt(),
    inputs: {
      title: req.title,
      scene: { id: scene.id, title: scene.title, narration: scene.narration, visuals: scene.visuals, elements: scene.elements ?? [], words: scene.words, durationMs: scene.durationMs },
      style: req.style,
      width: WIDTH, height: HEIGHT, fps: FPS,
      durationSeconds: Number((scene.durationMs / 1000).toFixed(3)),
      compositionId: compositionId(scene.id),
      comments: req.comments ?? [],
      ...(previousError ? { previousError } : {}),
    },
    expectFiles: [SCENE_FILE],
    tools: SCENE_TOOLS,
  }, { workdir: dir, model: agent.model, effort: agent.effort, signal: req.signal, onLog: req.onLog });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  if (!(await exists(join(dir, SCENE_FILE)))) throw new Error(`agent did not write ${SCENE_FILE}`);
}

async function renderComposition(tc: Toolchain, dir: string, out: string, req: RenderRequest): Promise<void> {
  const env = hyperframesEnv();
  const lint = await exec(process.execPath, [tc.cli, 'lint', dir], { env, signal: req.signal, timeoutMs: 120_000 });
  if (lint.code !== 0) throw new Error(`hyperframes lint failed:\n${tail(lint.stdout + lint.stderr)}`);
  const r = await exec(process.execPath, [tc.cli, 'render', dir, '-o', out, '--fps', String(FPS), '--strict'], { env, signal: req.signal, timeoutMs: RENDER_TIMEOUT_MS });
  if (r.code !== 0 || !(await exists(out))) throw new Error(`hyperframes render failed (exit ${r.code}):\n${tail(r.stdout + r.stderr)}`);
}

/**
 * Adds the narration and normalizes every clip (1920x1080, 30 fps, yuv420p H.264, 48 kHz stereo
 * AAC, exact scene length: last frame held / audio padded or trimmed) so concat can stream-copy.
 */
async function muxScene(raw: string, scene: TimedScene, clip: string, signal?: AbortSignal): Promise<void> {
  const secs = (scene.durationMs / 1000).toFixed(3);
  const audio = scene.audioFile ? ['-i', scene.audioFile] : ['-f', 'lavfi', '-t', secs, '-i', 'anullsrc=r=48000:cl=stereo'];
  await ffmpeg(['-i', raw, ...audio,
    '-filter_complex',
    `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS},format=yuv420p,tpad=stop_mode=clone:stop_duration=${secs}[v];` +
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[a]`,
    '-map', '[v]', '-map', '[a]', '-t', secs,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', clip], { signal });
}
