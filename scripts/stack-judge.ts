// Blind judge for the animation-stack bakeoff (#10). Samples frames from each render, shuffles the
// renders to labels A-D, and has Opus 5.5 score them against docs/bakeoffs/animation-stack.md.
//
//   node scripts/stack-judge.ts <runDir> <docsDir>
//
// Writes <docsDir>/judge.json (scores, rationale, label mapping), contact sheets and 720p copies.
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClaudeSurface, SUBSCRIPTION } from '../src/providers/claude/agent.ts';
import { ffmpeg } from '../src/media.ts';

const run = resolve(process.argv[2]);
const docs = resolve(process.argv[3] ?? 'docs/bakeoffs/animation-stack');
const metrics: any[] = JSON.parse(await readFile(join(run, 'metrics.json'), 'utf8'));
const ok = metrics.filter((m) => m.ok);
const labels = ['A', 'B', 'C', 'D'].slice(0, ok.length);
const shuffled = [...ok].sort(() => Math.random() - 0.5);
const work = join(run, 'judge');
await mkdir(docs, { recursive: true });

const CRITERIA = [
  ['style', 3, 'Style fidelity: unmistakably the seed style (near-black, neon green/blue, acid-yellow highlights, high contrast, flat geometric vectors, blueprint grid).'],
  ['motion', 3, 'Motion quality: smooth, eased, purposeful (pop-overshoot entrances, staggered groups, line draw-ons); no jank, jumps or dead frames.'],
  ['camera', 2, 'Camera: visible, smooth moves every scene; a dive-through or pull-back that connects scenes.'],
  ['sync', 2, 'Sync with narration: highlights and pop-ups land on the words that name them.'],
  ['coverage', 1, 'Element coverage: opening, transition, text pop-ups, boxes, diagram, camera movement all present.'],
  ['polish', 2, 'Legibility and polish: readable at 1080p, inside the safe area, nothing clipped or overlapping.'],
  ['humour', 1, 'Humour and tone: one dry aside that lands, never at the expense of clarity.'],
] as const;

const inputs: Record<string, unknown> = {};
for (const [i, m] of shuffled.entries()) {
  const L = labels[i];
  const tag = `${m.model}-${m.stack}`;
  const video = join(run, tag, 'output.mp4');
  await mkdir(join(work, 'frames', L), { recursive: true });
  await ffmpeg(['-i', video, '-vf', 'fps=2,scale=960:-2', '-q:v', '4', join(work, 'frames', L, 'f%03d.jpg')]);
  const frames = (await readdir(join(work, 'frames', L))).sort();
  const timeline = JSON.parse(await readFile(join(run, m.model, 'timeline.json'), 'utf8'));
  inputs[L] = { frames: frames.map((f, k) => ({ file: `frames/${L}/${f}`, atMs: k * 500 })), scenes: timeline.map((s: any) => ({ id: s.id, title: s.title, narration: s.narration, startMs: s.startMs, durationMs: s.durationMs, words: s.words })) };
  // For the write-up: a contact sheet (1 fps) and a 720p copy.
  await ffmpeg(['-i', video, '-vf', 'fps=1,scale=480:-2,tile=4x3', '-frames:v', '1', join(docs, `${tag}-sheet.png`)]);
  await ffmpeg(['-i', video, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', join(docs, `${tag}.mp4`)]);
}
await copyFile(new URL('../seed/styles/hitchhikers-guide/DESIGN.md', import.meta.url), join(work, 'SEED-DESIGN.md'));

const prompt = `You are judging an animation bakeoff, blind. ${labels.length} renders (${labels.join(', ')}) of a ~10 second
style sample, each meant to show off the same style. The style is in SEED-DESIGN.md (read it first).

inputs.json has, per render: frames (JPEGs sampled every 500 ms, with atMs) and the scenes with narration
and word timings. Read EVERY frame of every render (the Read tool shows images). Judge motion and camera
from how consecutive frames change; judge sync by comparing frame times with word timings.

Score each render 1-5 (5 best) on each criterion:
${CRITERIA.map(([k, w, d]) => `- ${k} (weight ${w}): ${d}`).join('\n')}

Be strict and specific; scores must discriminate between renders. Write result.json in your working directory:
{ "renders": { "A": { "scores": { ${CRITERIA.map(([k]) => `"${k}": 1-5`).join(', ')} }, "strengths": "...", "weaknesses": "..." }, ... }, "ranking": ["best label", ...], "summary": "2-3 sentences" }`;

const res = await createClaudeSurface(SUBSCRIPTION).run({
  kind: 'stack-judge', prompt, inputs, resultFile: 'result.json', tools: ['Read', 'Write'],
}, { workdir: work, model: 'claude-opus-5-5', effort: 'high', onLog: (l) => console.log(`[judge] ${l}`) });
if (!res.ok) throw new Error(`judge failed: ${res.error.message}`);

const results = shuffled.map((m, i) => {
  const r = res.output.renders[labels[i]];
  const total = CRITERIA.reduce((s, [k, w]) => s + w * Number(r.scores[k] ?? 0), 0);
  return { label: labels[i], model: m.model, stack: m.stack, total, ...r, renderMs: m.renderMs, sceneAgentCostUsd: m.sceneAgent.costUsd, planCostUsd: m.planCostUsd, sceneAgentTasks: m.sceneAgent.tasks, sceneAgentFailures: m.sceneAgent.failures };
});
const failed = metrics.filter((m) => !m.ok).map((m) => ({ model: m.model, stack: m.stack, error: m.error, renderMs: m.renderMs }));
await writeFile(join(docs, 'judge.json'), JSON.stringify({ judge: 'claude-opus-5-5 high, blind', usage: res.usage, results, ranking: res.output.ranking, summary: res.output.summary, failed }, null, 2));
console.log(JSON.stringify({ results: results.map(({ label, model, stack, total }) => ({ label, model, stack, total })), summary: res.output.summary, failed }, null, 2));
