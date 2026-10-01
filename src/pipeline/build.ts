import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { App } from '../app.ts';
import type { JobCtx } from '../jobs.ts';
import type { OutputType } from '../settings.ts';
import { ExplainerStore, type Explainer, type ScriptScene, type OutputRound, type Comment } from '../explainer/store.ts';
import type { TimedScene } from '../providers/types.ts';
import { scriptPrompt, revisePrompt } from '../prompts/explainer.ts';
import { narrateScenes } from './narrate.ts';
import { surfaceFor } from './explainer-prep.ts';

/** Scene ids name files and folders, so they must be safe path segments. */
export const SCENE_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Which scene a comment touches: explicit scene, else the scene under its timestamp, else null (whole piece). */
export function commentScene(c: Comment, scenes: { id: string; startMs: number; durationMs: number }[]): string | null {
  if (c.sceneId && scenes.some((s) => s.id === c.sceneId)) return c.sceneId;
  if (c.atMs !== undefined) {
    const hit = scenes.find((s) => c.atMs! >= s.startMs && c.atMs! < s.startMs + s.durationMs) ?? scenes.at(-1);
    return hit?.id ?? null;
  }
  return null;
}

function validScenes(out: any, ids?: string[]): ScriptScene[] {
  const scenes = out?.scenes;
  if (!Array.isArray(scenes) || !scenes.length) throw new Error('the agent returned no scenes');
  for (const s of scenes) {
    if (!s?.id || typeof s.narration !== 'string' || typeof s.visuals !== 'string') throw new Error(`scene ${s?.id ?? '?'} lacks id/narration/visuals`);
    if (!SCENE_ID.test(String(s.id))) throw new Error(`scene id ${JSON.stringify(s.id)} must be letters, digits, - or _ (it names files)`);
  }
  if (ids) {
    const missing = ids.filter((id) => !scenes.some((s: any) => s.id === id));
    if (missing.length) throw new Error(`the agent did not return scenes ${missing.join(', ')}`);
  }
  return scenes.map((s: any) => ({ id: String(s.id), title: String(s.title ?? s.id), narration: s.narration, visuals: s.visuals, ...(s.purpose ? { purpose: s.purpose } : {}) }));
}

const FILE_NAME: Record<OutputType, string> = { video: 'video.mp4', deck: 'deck.html', doc: 'doc.pdf', visual: 'visual.png' };

/**
 * Builds (mode 'build') or re-renders (mode 'rerender') one output type of an explainer.
 * Build: script from the approved plan, then everything. Re-render: revise the scenes that
 * comments touch, re-narrate changed narration, re-render dirty scenes, reuse the rest.
 */
export async function runBuild(app: App, id: string, type: OutputType, mode: 'build' | 'rerender', ctx: JobCtx) {
  const store = app.explainers;
  const e: Explainer = await store.get(id);
  if (!e.styleId) throw new Error('pick a style first');
  // A build needs the approved plan; a re-render works from the built script (a revised plan may be pending).
  const plan = ExplainerStore.approved(e, type)?.plan ?? (mode === 'rerender' ? ExplainerStore.latestPlan(e, type)?.plan : undefined);
  if (!plan) throw new Error('approve a plan first');
  const styleMeta = await app.styles.meta(e.styleId);
  const style = await app.styles.design(e.styleId);
  const agent = surfaceFor(app, e.surface);
  const run = { model: e.model, effort: e.effort, signal: ctx.signal, onLog: ctx.log };
  const work = join(app.paths.home, 'work', ctx.id);
  const state = e.outputs[type];
  const prev = mode === 'rerender' ? state?.rounds.find((r) => r.n === state.current) : undefined;
  if (mode === 'rerender' && !prev) throw new Error('build it first');

  let script: ScriptScene[];
  let dirty: string[];
  let renderComments: string[] = [];
  if (mode === 'build' || !prev) {
    ctx.stage('Writing the script', 0.05, `${e.model} · ${e.effort}`);
    const res = await agent.run({
      kind: 'explainer-script', prompt: scriptPrompt(type),
      inputs: { plan, report: e.report, corrections: e.corrections.map((c) => c.text), style, brief: e.brief, outputType: type },
      resultFile: 'result.json',
    }, { ...run, workdir: join(work, 'script') });
    if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
    script = validScenes(res.output);
    dirty = script.map((s) => s.id);
  } else {
    // Start from the (possibly hand-edited) script; mark scenes touched by comments or edits.
    script = state!.script.map((s) => ({ ...s }));
    const edited = script.filter((s) => {
      const before = prev.scenes.find((p) => p.id === s.id);
      return !before || before.narration !== s.narration || before.visuals !== s.visuals;
    }).map((s) => s.id);
    const anchored = prev.comments.map((c) => ({ text: c.text, sceneId: commentScene(c, prev.scenes) }));
    // The user's exact words also go to the renderer, so per-scene agents see them, not just the revised script.
    renderComments = anchored.map((c) => (c.sceneId ? `[${c.sceneId}] ${c.text}` : c.text));
    const commented = anchored.some((c) => c.sceneId === null) ? script.map((s) => s.id) : [...new Set(anchored.map((c) => c.sceneId!))];
    if (commented.length) {
      ctx.stage('Revising scenes', 0.05, `${commented.length} scene${commented.length === 1 ? '' : 's'} with comments`);
      const res = await agent.run({
        kind: 'explainer-revise', prompt: revisePrompt(),
        inputs: { script, comments: anchored, style, dirty: commented, outputType: type },
        resultFile: 'result.json',
      }, { ...run, workdir: join(work, 'revise') });
      if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
      const revised = validScenes(res.output, commented);
      script = script.map((s) => revised.find((r) => r.id === s.id) ?? s);
    }
    dirty = [...new Set([...edited, ...commented])];
    if (!dirty.length) throw new Error('nothing to re-render: add a comment or edit the script');
  }

  const n = (state?.rounds.at(-1)?.n ?? 0) + 1;
  const dir = store.roundDir(id, type, n);
  await mkdir(dir, { recursive: true });

  let timed: TimedScene[] = script.map((s) => ({ ...s, startMs: 0, durationMs: 0, words: [] }));
  let narrated: string[] = [];
  if (type === 'video') {
    ctx.stage('Narrating', 0.25);
    const prevDir = prev ? store.roundDir(id, type, prev.n) : null;
    const reuse = new Map<string, TimedScene>();
    if (prev && prevDir) {
      // Word timings live in the round's timeline.json (not in explainer.json).
      const prevTimeline: TimedScene[] = await readFile(join(prevDir, 'timeline.json'), 'utf8').then(JSON.parse, () => []);
      const wordsOf = (sid: string) => prevTimeline.find((t) => t.id === sid)?.words ?? [];
      for (const s of prev.scenes) if (!dirty.includes(s.id) || script.find((x) => x.id === s.id)?.narration === s.narration) {
        reuse.set(s.id, { ...s, audioFile: join(prevDir, 'audio', `${s.id}.wav`), words: wordsOf(s.id) });
      }
    }
    timed = await narrateScenes({
      tts: app.providers.tts(styleMeta.voice.provider), voiceId: styleMeta.voice.voiceId, controls: styleMeta.voice.controls,
      scenes: script, dir: join(dir, 'audio'), reuse, signal: ctx.signal,
      onScene: (i, s, reused) => {
        if (!reused) narrated.push(s.id);
        ctx.progress(0.25 + 0.2 * (i / script.length), `scene ${i + 1}/${script.length}: ${s.title}${reused ? ' (unchanged)' : ''}`);
        if (!reused) ctx.log(`narrating scene ${i + 1}/${script.length}: ${s.id}`);
      },
    });
    // Reused clips live in the previous round; copy them in so this round is self-contained.
    for (const s of timed) {
      const target = join(dir, 'audio', `${s.id}.wav`);
      if (s.audioFile && s.audioFile !== target) { await copyFile(s.audioFile, target); s.audioFile = target; }
    }
    // A scene whose duration changed must be re-rendered even if its visuals didn't.
    if (prev) for (const s of timed) {
      const before = prev.scenes.find((p) => p.id === s.id);
      if (before && before.durationMs !== s.durationMs && !dirty.includes(s.id)) dirty.push(s.id);
    }
  }

  ctx.stage('Rendering', 0.5, `${dirty.length} of ${script.length} scenes`);
  const renderer = app.providers.renderer(type);
  const out = await renderer.render({
    outputType: type, style, title: plan.title || e.title, scenes: timed, workdir: join(dir, 'render'),
    dirtyScenes: mode === 'build' ? undefined : dirty,
    cacheDir: prev ? join(store.roundDir(id, type, prev.n), 'render') : undefined,
    agent: { surface: agent, model: e.model, effort: e.effort }, comments: renderComments, onLog: ctx.log, signal: ctx.signal,
    onScene: (sceneId, i, total) => {
      const s = script.find((x) => x.id === sceneId);
      ctx.progress(0.5 + 0.4 * (i / total), `scene ${i + 1}/${total}: ${s?.title ?? sceneId}`);
      ctx.log(`rendering scene ${i + 1}/${total}: ${sceneId}`);
    },
  });

  ctx.stage('Packaging', 0.95);
  await writeFile(join(dir, 'timeline.json'), JSON.stringify(timed.map(({ audioFile, ...s }) => s), null, 2));
  const files: string[] = [];
  const primaryName = FILE_NAME[type];
  await copyFile(out.primary, join(dir, primaryName));
  files.push(primaryName);
  for (const f of out.files) {
    if (f === out.primary) continue;
    const name = `${type}${extname(f)}` === primaryName ? basename(f) : `${type}${extname(f)}`;
    await copyFile(f, join(dir, name));
    files.push(name);
  }
  const round: OutputRound = {
    n, createdAt: new Date().toISOString(), model: e.model, effort: e.effort, styleRound: styleMeta.currentRound,
    voice: type === 'video' ? { provider: styleMeta.voice.provider, voiceId: styleMeta.voice.voiceId } : undefined,
    scenes: timed.map(({ id, title, narration, visuals, startMs, durationMs }) => {
      const purpose = script.find((s) => s.id === id)?.purpose;
      return { id, title, narration, visuals, ...(purpose ? { purpose } : {}), startMs, durationMs };
    }),
    comments: [], files, durationMs: out.durationMs,
    rendered: mode === 'build' ? timed.map((s) => s.id) : out.rendered, narrated: type === 'video' ? narrated : [],
    basedOn: prev?.n ?? null,
  };
  await store.update(id, (x) => {
    const s = x.outputs[type] ?? { script: [], rounds: [], current: null };
    s.script = script;
    s.rounds.push(round);
    s.current = n;
    x.outputs[type] = s;
    x.status = 'built';
  });
  ctx.log(`round ${n}: rendered ${round.rendered.join(', ') || 'nothing'}`);
  return { round: n };
}
