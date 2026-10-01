// Animation-stack bakeoff (#10): the seed style's sample planned once per model, narrated once with
// Polly, then rendered by Remotion and HyperFrames with the same model writing scene code.
//
//   EXPLAINER_LIVE_AWS_PROFILE=<profile> node scripts/stack-bakeoff.ts <outDir>
//
// Real claude -p (subscription), real Polly, real renderers. Writes <outDir>/<model>-<stack>/output.mp4
// and <outDir>/metrics.json. Takes tens of minutes and costs real money.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { AgentSurface, AgentUsage, Renderer, TimedScene } from '../src/providers/types.ts';
import { createClaudeSurface, SUBSCRIPTION } from '../src/providers/claude/agent.ts';
import { createPollyTts } from '../src/providers/polly/tts.ts';
import { createRemotionRenderer } from '../src/providers/remotion/renderer.ts';
import { createHyperFramesRenderer } from '../src/providers/hyperframes/renderer.ts';
import { hyperframesCacheRoot } from '../src/providers/hyperframes/checks.ts';
import { styleSamplePrompt } from '../src/prompts/style.ts';
import { validateDesign } from '../src/style/design.ts';
import { validateScenes } from '../src/pipeline/style-sample.ts';
import { narrateScenes } from '../src/pipeline/narrate.ts';

const out = resolve(process.argv[2] ?? '.tmp/stack-bakeoff');
const profile = process.env.EXPLAINER_LIVE_AWS_PROFILE;
const MODELS = [{ id: 'claude-opus-5-5', effort: 'high' }, { id: 'claude-fable-5-1', effort: 'high' }];
const STACKS: Record<string, () => Renderer> = {
  remotion: () => createRemotionRenderer({ projectDir: process.env.EXPLAINER_REMOTION_CACHE ?? join(tmpdir(), 'rocket-explainer-remotion-cache') }),
  hyperframes: () => createHyperFramesRenderer({ cacheRoot: hyperframesCacheRoot(process.env.EXPLAINER_HOME ?? join(tmpdir(), 'rocket-explainer-live')) }),
};
const VOICE = { voiceId: 'Brian:generative', controls: {} };
const DESCRIPTION = "Hitchhiker's Guide animations, very smooth transitions, camera movement, highlights of what's appearing, neon blue/green, high contrast, lively, room for humor.";

/** Wraps a surface to total usage across every task it runs. */
function metered(surface: AgentSurface) {
  const total: Required<AgentUsage> & { tasks: number; failures: number } = { inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, tasks: 0, failures: 0 };
  const wrapped: AgentSurface = {
    ...surface,
    async run(task, opts) {
      const r = await surface.run(task, opts);
      total.tasks++;
      if (!r.ok) total.failures++;
      for (const k of ['inputTokens', 'outputTokens', 'costUsd', 'durationMs'] as const) total[k] += r.usage?.[k] ?? 0;
      return r;
    },
  };
  return { surface: wrapped, total };
}

const log = (tag: string) => (line: string) => console.log(`[${tag}] ${line}`);
const seed = await readFile(new URL('../seed/styles/hitchhikers-guide/DESIGN.md', import.meta.url), 'utf8');
const tts = createPollyTts(() => ({ region: 'us-east-1', profile }));
const metrics: any[] = [];
await mkdir(out, { recursive: true });

await Promise.all(MODELS.map(async (m) => {
  const dir = join(out, m.id);
  await mkdir(dir, { recursive: true });
  const plan = metered(createClaudeSurface(SUBSCRIPTION));
  const t0 = Date.now();
  const res = await plan.surface.run({
    kind: 'style-sample', prompt: styleSamplePrompt(),
    inputs: { description: DESCRIPTION, currentDesign: seed, comments: [], previousScenes: [], voice: { provider: 'polly', ...VOICE }, outputType: 'video' },
    resultFile: 'result.json',
  }, { workdir: join(dir, 'plan'), model: m.id, effort: m.effort, onLog: log(`${m.id} plan`) });
  if (!res.ok) throw new Error(`${m.id} plan failed: ${res.error.message}`);
  const problems = [...validateDesign(res.output.design), ...validateScenes(res.output.scenes)];
  if (problems.length) throw new Error(`${m.id} plan invalid: ${problems.join('; ')}`);
  await writeFile(join(dir, 'DESIGN.md'), res.output.design);
  await writeFile(join(dir, 'plan.json'), JSON.stringify(res.output, null, 2));
  const planMs = Date.now() - t0;
  const timed: TimedScene[] = await narrateScenes({ tts, voiceId: VOICE.voiceId, controls: VOICE.controls, scenes: res.output.scenes, dir: join(dir, 'audio') });
  await writeFile(join(dir, 'timeline.json'), JSON.stringify(timed.map(({ audioFile, ...s }) => s), null, 2));

  await Promise.all(Object.entries(STACKS).map(async ([stack, make]) => {
    const tag = `${m.id}-${stack}`;
    const agent = metered(createClaudeSurface(SUBSCRIPTION));
    const t1 = Date.now();
    const entry: any = { model: m.id, effort: m.effort, stack, planMs, planCostUsd: plan.total.costUsd };
    try {
      const r = await make().render({
        outputType: 'video', style: res.output.design, title: "Hitchhiker's Guide sample", scenes: timed,
        workdir: join(out, tag, 'render'), agent: { surface: agent.surface, model: m.id, effort: m.effort }, onLog: log(tag),
      });
      await copyFile(r.primary, join(out, tag, 'output.mp4'));
      Object.assign(entry, { ok: true, durationMs: r.durationMs, sceneCount: r.sceneCount });
    } catch (err: any) {
      Object.assign(entry, { ok: false, error: String(err?.message ?? err).slice(0, 2000) });
    }
    Object.assign(entry, { renderMs: Date.now() - t1, sceneAgent: agent.total });
    metrics.push(entry);
    console.log(`[${tag}] ${entry.ok ? 'done' : 'FAILED'} in ${Math.round(entry.renderMs / 1000)}s, scene agents $${agent.total.costUsd.toFixed(2)}`);
    await writeFile(join(out, 'metrics.json'), JSON.stringify(metrics, null, 2));
  }));
}));
console.log(JSON.stringify(metrics, null, 2));
