import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Renderer, RenderRequest, RenderResult, TimedScene } from '../types.ts';
import { exec, ffmpeg } from '../../media.ts';
import { parseDesign } from '../../style/design.ts';
import { ensureProject, prepareRenderProject } from './project.ts';
import { remotionScenePrompt } from './prompt.ts';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Agent attempts per scene: the first, plus one retry with the compile/render error fed back. */
const MAX_ATTEMPTS = 2;
const AGENT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill'];

const exists = (f: string) => access(f).then(() => true, () => false);

/** Remotion composition IDs allow only letters, digits and dashes. */
export function compositionId(sceneId: string): string {
  return `scene-${sceneId.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

export function sceneFile(sceneId: string): string {
  return `src/scenes/${compositionId(sceneId).slice('scene-'.length)}.tsx`;
}

const frames = (ms: number) => Math.max(1, Math.round((ms * FPS) / 1000));

function sceneProps(scene: TimedScene, tokens: Record<string, unknown>) {
  return {
    scene: {
      id: scene.id, title: scene.title, narration: scene.narration, visuals: scene.visuals, elements: scene.elements ?? [],
      durationMs: scene.durationMs,
      words: scene.words.map((w) => ({ ...w, startFrame: Math.floor((w.startMs * FPS) / 1000), endFrame: Math.ceil((w.endMs * FPS) / 1000) })),
    },
    style: tokens,
  };
}

interface PassResult { rendered: Set<string>; faults: Map<string, string> }

export function createRemotionRenderer(opts: { projectDir: string }): Renderer {
  return {
    id: 'remotion',
    label: 'Remotion',
    outputTypes: ['video'],
    async render(req: RenderRequest): Promise<RenderResult> {
      const log = req.onLog ?? (() => {});
      const agent = req.agent;
      if (!agent) throw new Error('the Remotion renderer needs an agent surface to write scene code');
      const checkCancelled = () => { if (req.signal?.aborted) throw new Error('cancelled'); };
      const byComp = new Map<string, string>();
      for (const s of req.scenes) {
        const prev = byComp.get(compositionId(s.id));
        if (prev !== undefined) throw new Error(`scene ids "${prev}" and "${s.id}" map to the same Remotion composition`);
        byComp.set(compositionId(s.id), s.id);
      }

      await mkdir(req.workdir, { recursive: true });
      const stamp = await ensureProject(opts.projectDir, { onLog: log, signal: req.signal });
      if (!stamp.skills) log('warning: the upstream Remotion skills are not installed; the agent will write scene code without them');
      checkCancelled();
      const project = join(req.workdir, 'project');
      await rm(project, { recursive: true, force: true });
      await prepareRenderProject(opts.projectDir, project);
      const tmp = join(req.workdir, 'tmp');
      await mkdir(tmp, { recursive: true });
      let tokens: Record<string, unknown> = {};
      try { tokens = parseDesign(req.style).tokens; } catch { /* the agent still gets the full DESIGN.md text */ }

      // Reuse clean scenes from the previous render.
      const dirty: TimedScene[] = [];
      const previousCode = new Map<string, string>();
      for (const scene of req.scenes) {
        const clip = join(req.workdir, `scene-${scene.id}.mp4`);
        const cachedClip = req.cacheDir ? join(req.cacheDir, `scene-${scene.id}.mp4`) : '';
        const cachedCode = req.cacheDir ? join(req.cacheDir, 'project', sceneFile(scene.id)) : '';
        if (cachedCode && await exists(cachedCode)) previousCode.set(scene.id, await readFile(cachedCode, 'utf8'));
        const isDirty = !req.dirtyScenes || req.dirtyScenes.includes(scene.id);
        if (!isDirty && cachedClip && await exists(cachedClip)) {
          if (cachedClip !== clip) await copyFile(cachedClip, clip);
          if (previousCode.has(scene.id)) await writeFile(join(project, sceneFile(scene.id)), previousCode.get(scene.id)!);
          log(`reused scene ${scene.id}`);
        } else {
          dirty.push(scene);
        }
      }

      const writeScene = async (scene: TimedScene, attempt: number, error?: string) => {
        checkCancelled();
        const file = sceneFile(scene.id);
        let prior = previousCode.get(scene.id);
        if (error) prior = await readFile(join(project, file), 'utf8').catch(() => prior);
        log(`writing scene ${scene.id}${attempt > 1 ? ` (attempt ${attempt}, after an error)` : ''}`);
        await rm(join(project, file), { force: true });
        const res = await agent.surface.run({
          kind: 'remotion-scene',
          prompt: remotionScenePrompt(),
          inputs: {
            file, compositionId: compositionId(scene.id), width: WIDTH, height: HEIGHT, fps: FPS,
            durationInFrames: frames(scene.durationMs), durationMs: scene.durationMs,
            scene: sceneProps(scene, tokens).scene, style: req.style, title: req.title, comments: req.comments ?? [],
            ...(prior !== undefined ? { previousCode: prior } : {}), ...(error ? { previousError: error } : {}),
          },
          expectFiles: [file],
          tools: AGENT_TOOLS,
        }, { workdir: project, model: agent.model, effort: agent.effort, signal: req.signal, onLog: log });
        if (!res.ok) throw new Error(`agent failed writing scene ${scene.id} (${res.error.kind}): ${res.error.message}`);
      };

      const renderPass = async (scenes: TimedScene[]): Promise<PassResult> => {
        checkCancelled();
        const comps = scenes.map((s) => ({ id: compositionId(s.id), durationInFrames: frames(s.durationMs), props: sceneProps(s, tokens) }));
        await writeFile(join(project, 'src', 'manifest.json'), JSON.stringify({ fps: FPS, width: WIDTH, height: HEIGHT, compositions: comps }, null, 2));
        await writeFile(join(project, 'src', 'scenes', 'index.ts'), [
          '// Generated by Rocket Explainer for this render pass.',
          ...scenes.map((s, i) => `import Scene${i} from './${sceneFile(s.id).slice('src/scenes/'.length, -'.tsx'.length)}';`),
          `export const SCENES = { ${scenes.map((s, i) => `'${compositionId(s.id)}': Scene${i}`).join(', ')} };`,
          '',
        ].join('\n'));
        await rm(join(project, 'build'), { recursive: true, force: true });
        await mkdir(join(project, 'out'), { recursive: true });
        await writeFile(join(project, 'job.json'), JSON.stringify({
          entry: 'src/index.ts', bundleDir: 'build',
          compositions: scenes.map((s) => ({ id: compositionId(s.id), out: join(project, 'out', `${compositionId(s.id)}.mp4`) })),
        }, null, 2));

        const result: PassResult = { rendered: new Set(), faults: new Map() };
        let finished = false;
        const onLine = (line: string) => {
          let ev: any;
          try { ev = JSON.parse(line); } catch { if (line.trim()) log(`remotion: ${line}`); return; }
          const sceneId = ev.id ? byComp.get(ev.id) : undefined;
          if (ev.type === 'bundled') log('remotion: bundled');
          else if (ev.type === 'progress') log(`remotion: ${sceneId} ${Math.round(ev.progress * 100)}%`);
          else if (ev.type === 'rendered' && sceneId) { result.rendered.add(sceneId); log(`rendered scene ${sceneId}`); }
          else if (ev.type === 'render-error' && sceneId) { result.faults.set(sceneId, ev.message); log(`scene ${sceneId} failed to render: ${firstLines(ev.message)}`); }
          else if (ev.type === 'bundle-error') {
            log(`remotion: bundling failed: ${firstLines(ev.message)}`);
            const blamed = scenes.filter((s) => ev.message.includes(sceneFile(s.id).slice('src/'.length)));
            for (const s of blamed.length ? blamed : scenes) result.faults.set(s.id, ev.message);
            finished = true;
          } else if (ev.type === 'done') finished = true;
        };
        const r = await exec(process.execPath, ['render.mjs', 'job.json'], {
          cwd: project, signal: req.signal, onLine, env: { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp },
        });
        checkCancelled();
        if (!finished) throw new Error(`Remotion render failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-1500)}`);
        return result;
      };

      // Write each dirty scene, render, and give a failing scene one more go with its error.
      const attempts = new Map<string, number>();
      for (const s of dirty) { await writeScene(s, 1); attempts.set(s.id, 1); }
      let remaining = dirty;
      while (remaining.length) {
        const pass = await renderPass(remaining);
        remaining = remaining.filter((s) => !pass.rendered.has(s.id));
        for (const s of remaining) {
          const fault = pass.faults.get(s.id);
          if (!fault) continue;
          const n = attempts.get(s.id)!;
          if (n >= MAX_ATTEMPTS) throw new Error(`scene ${s.id} failed to render after ${n} attempts: ${firstLines(fault, 12)}`);
          await writeScene(s, n + 1, fault.slice(0, 4000));
          attempts.set(s.id, n + 1);
        }
      }

      // Mux narration into each rendered scene, then concat everything.
      for (const s of dirty) {
        checkCancelled();
        const silent = join(project, 'out', `${compositionId(s.id)}.mp4`);
        const secs = (frames(s.durationMs) / FPS).toFixed(3);
        const audio = s.audioFile ? ['-i', s.audioFile] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
        await ffmpeg(['-i', silent, ...audio, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', 'apad',
          '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-t', secs, join(req.workdir, `scene-${s.id}.mp4`)], { signal: req.signal });
      }
      const list = join(req.workdir, 'concat.txt');
      await writeFile(list, req.scenes.map((s) => `file '${join(req.workdir, `scene-${s.id}.mp4`).replace(/'/g, "'\\''")}'`).join('\n') + '\n');
      const out = join(req.workdir, 'output.mp4');
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal: req.signal });
      for (const d of [join(project, 'build'), join(project, 'out'), tmp]) await rm(d, { recursive: true, force: true });

      const durationMs = req.scenes.reduce((sum, s) => sum + Math.round((frames(s.durationMs) * 1000) / FPS), 0);
      return { primary: out, files: [out], durationMs, sceneCount: req.scenes.length, rendered: dirty.map((s) => s.id) };
    },
  };
}

function firstLines(text: string, n = 4): string {
  return text.split('\n').slice(0, n).join('\n');
}
