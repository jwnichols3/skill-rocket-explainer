import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { OutputType } from '../settings.ts';
import type { App } from '../app.ts';
import type { JobCtx } from '../jobs.ts';
import type { ScenePlan, TimedScene } from '../providers/types.ts';
import type { StyleComment } from '../style/store.ts';
import { validateDesign } from '../style/design.ts';
import { styleSamplePrompt, styleTypeSamplePrompt, SAMPLE_ELEMENTS } from '../prompts/style.ts';
import { narrateScenes } from './narrate.ts';
import { referenceInputs } from './style-helpers.ts';

export function validateScenes(scenes: unknown): string[] {
  if (!Array.isArray(scenes) || scenes.length === 0) return ['scenes must be a non-empty array'];
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const [i, s] of scenes.entries()) {
    if (!s || typeof s !== 'object') { problems.push(`scene ${i} is not an object`); continue; }
    for (const k of ['id', 'title', 'narration', 'visuals']) if (typeof (s as any)[k] !== 'string' || !(s as any)[k].trim()) problems.push(`scene ${i} lacks ${k}`);
    if (ids.has((s as any).id)) problems.push(`duplicate scene id ${(s as any).id}`);
    ids.add((s as any).id);
  }
  return problems;
}

/**
 * One round of the style loop: the agent writes/refines the style and plans a ~10 s sample,
 * TTS narrates it, the video renderer renders it, and the result becomes the style's new round.
 */
export async function runStyleSample(app: App, styleId: string, ctx: JobCtx, opts: { comments: StyleComment[]; basedOn: number | null; outputType?: OutputType }) {
  const store = app.styles;
  const meta = await store.meta(styleId);
  const currentDesign = await store.design(styleId);
  const rounds = await store.rounds(styleId);
  const previous = opts.basedOn ? rounds.find((r) => r.n === opts.basedOn) : rounds.at(-1);
  const type: OutputType = opts.outputType ?? 'video';
  const work = join(app.paths.home, 'work', ctx.id);
  await mkdir(work, { recursive: true });

  ctx.stage('Designing the style', 0.05, `${meta.model} · ${meta.effort}`);
  const agent = app.providers.agent();
  const references = await referenceInputs(app, styleId, meta.references ?? [], join(work, 'agent'));
  const res = await agent.run({
    kind: 'style-sample',
    prompt: type === 'video' ? styleSamplePrompt() : styleTypeSamplePrompt(type),
    inputs: {
      description: meta.description,
      currentDesign,
      comments: opts.comments.map(({ text, atMs }) => ({ text, atMs })),
      previousScenes: previous?.scenes ?? [],
      voice: meta.voice,
      outputType: type,
      references,
    },
    resultFile: 'result.json',
  }, { workdir: join(work, 'agent'), model: meta.model, effort: meta.effort, signal: ctx.signal, onLog: ctx.log });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  const { design, scenes, summary } = res.output ?? {};
  const problems = [...(typeof design === 'string' ? validateDesign(design) : ['design is missing']), ...validateScenes(scenes)];
  if (problems.length) throw new Error(`the agent's style is invalid: ${problems.join('; ')}`);
  const plan = (scenes as ScenePlan[]).map((s) => ({ ...s, elements: (s.elements ?? []).filter((e) => (SAMPLE_ELEMENTS as readonly string[]).includes(e)) }));

  let timed: TimedScene[] = plan.map((s) => ({ ...s, startMs: 0, durationMs: 0, words: [] }));
  if (type === 'video') {
    ctx.stage('Narrating', 0.3);
    const tts = app.providers.tts(meta.voice.provider);
    timed = await narrateScenes({
      tts, voiceId: meta.voice.voiceId, controls: meta.voice.controls, scenes: plan, dir: join(work, 'audio'), signal: ctx.signal,
      onScene: (i, s) => ctx.progress(0.3 + 0.2 * (i / plan.length), `scene ${i + 1}/${plan.length}: ${s.title}`),
    });
  }

  ctx.stage('Rendering', 0.5);
  const renderer = app.providers.renderer(type);
  const out = await renderer.render({
    outputType: type, style: design, title: meta.name ?? 'Style sample', scenes: timed, workdir: join(work, 'render'),
    agent: { surface: agent, model: meta.model, effort: meta.effort }, onLog: ctx.log, signal: ctx.signal,
  });

  ctx.stage('Saving round', 0.95);
  const stage = join(work, 'round');
  await mkdir(stage, { recursive: true });
  // Primary first: sample.mp4 / sample.html (+ .pptx) / sample.pdf (+ .md) / sample.png (+ .html).
  const files: string[] = [];
  for (const f of [out.primary, ...out.files.filter((f) => f !== out.primary)]) {
    const name = `sample${extname(f)}`;
    if (files.includes(name)) continue;
    await copyFile(f, join(stage, name));
    files.push(name);
  }
  await writeFile(join(stage, 'timeline.json'), JSON.stringify(timed.map(({ audioFile, ...s }) => s), null, 2));
  const round = await store.addRound(styleId, {
    model: meta.model, effort: meta.effort, voice: meta.voice, summary: String(summary ?? ''),
    scenes: timed.map(({ id, title, narration, visuals, elements, startMs, durationMs }) => ({ id, title, narration, visuals, elements, startMs, durationMs })),
    durationMs: out.durationMs, basedOn: previous?.n ?? null, usage: res.usage,
    ...(type === 'video' ? {} : { outputType: type }), files,
  }, design, stage);
  ctx.log(`round ${round.n} saved`);
  return { round: round.n };
}
