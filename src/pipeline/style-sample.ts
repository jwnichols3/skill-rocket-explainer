import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { App } from '../app.ts';
import type { JobCtx } from '../jobs.ts';
import type { ScenePlan } from '../providers/types.ts';
import type { StyleComment } from '../style/store.ts';
import { validateDesign } from '../style/design.ts';
import { styleSamplePrompt, SAMPLE_ELEMENTS } from '../prompts/style.ts';
import { narrateScenes } from './narrate.ts';

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
export async function runStyleSample(app: App, styleId: string, ctx: JobCtx, opts: { comments: StyleComment[]; priorComments: StyleComment[]; basedOn: number | null }) {
  const store = app.styles;
  const meta = await store.meta(styleId);
  const currentDesign = await store.design(styleId);
  const rounds = await store.rounds(styleId);
  const previous = opts.basedOn ? rounds.find((r) => r.n === opts.basedOn) : rounds.at(-1);
  const work = join(app.paths.home, 'work', ctx.id);
  await mkdir(work, { recursive: true });

  ctx.stage('Designing the style', 0.05, `${meta.model} · ${meta.effort}`);
  const agent = app.providers.agent();
  const res = await agent.run({
    kind: 'style-sample',
    prompt: styleSamplePrompt(),
    inputs: {
      description: meta.description,
      currentDesign,
      comments: opts.comments.map(({ text, atMs }) => ({ text, atMs })),
      priorComments: opts.priorComments.map(({ text }) => ({ text })),
      previousScenes: previous?.scenes ?? [],
      voice: meta.voice,
    },
    resultFile: 'result.json',
  }, { workdir: join(work, 'agent'), model: meta.model, effort: meta.effort, signal: ctx.signal, onLog: ctx.log });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  const { design, scenes, summary } = res.output ?? {};
  const problems = [...(typeof design === 'string' ? validateDesign(design) : ['design is missing']), ...validateScenes(scenes)];
  if (problems.length) throw new Error(`the agent's style is invalid: ${problems.join('; ')}`);
  const plan = (scenes as ScenePlan[]).map((s) => ({ ...s, elements: (s.elements ?? []).filter((e) => (SAMPLE_ELEMENTS as readonly string[]).includes(e)) }));

  ctx.stage('Narrating', 0.3);
  const tts = app.providers.tts(meta.voice.provider);
  const timed = await narrateScenes({
    tts, voiceId: meta.voice.voiceId, controls: meta.voice.controls, scenes: plan, dir: join(work, 'audio'), signal: ctx.signal,
    onScene: (i, s) => ctx.progress(0.3 + 0.2 * (i / plan.length), `scene ${i + 1}/${plan.length}: ${s.title}`),
  });

  ctx.stage('Rendering', 0.5);
  const renderer = app.providers.renderer('video');
  const out = await renderer.render({
    outputType: 'video', style: design, title: meta.name ?? 'Style sample', scenes: timed, workdir: join(work, 'render'),
    agent: { surface: agent, model: meta.model, effort: meta.effort }, onLog: ctx.log, signal: ctx.signal,
  });

  ctx.stage('Saving round', 0.95);
  const stage = join(work, 'round');
  await mkdir(stage, { recursive: true });
  await copyFile(out.primary, join(stage, 'sample.mp4'));
  await writeFile(join(stage, 'timeline.json'), JSON.stringify(timed.map(({ audioFile, ...s }) => s), null, 2));
  const round = await store.addRound(styleId, {
    model: meta.model, effort: meta.effort, voice: meta.voice, summary: String(summary ?? ''),
    scenes: timed.map(({ id, title, narration, visuals, elements, startMs, durationMs }) => ({ id, title, narration, visuals, elements, startMs, durationMs })),
    durationMs: out.durationMs, basedOn: previous?.n ?? null, usage: res.usage,
  }, design, stage);
  ctx.log(`round ${round.n} saved`);
  return { round: round.n };
}
