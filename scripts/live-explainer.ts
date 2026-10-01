// Live end-to-end explainer run (#12): real claude -p, real Polly, real renderer, through the app's API.
//
//   EXPLAINER_LIVE_AWS_PROFILE=<profile> node scripts/live-explainer.ts <outDir> [type] [renderer]
//
// Sources: this repo's intent and prior-art docs. Builds, then leaves one scene comment and
// re-renders, to prove partial re-render on real providers. Prints timings and the output paths.
import { mkdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../src/server.ts';

const out = resolve(process.argv[2] ?? '.tmp/live-explainer');
const type = process.argv[3] ?? 'video';
const renderer = process.argv[4];
const repo = fileURLToPath(new URL('..', import.meta.url));
await mkdir(out, { recursive: true });
const providers: Record<string, unknown> = { agent: 'claude-subscription', tts: 'polly' };
if (renderer) providers.renderer = { [type]: renderer };
const app = await startServer({
  home: join(out, 'home'), port: 0,
  settings: { setupComplete: true, providers, polly: { region: 'us-east-1', profile: process.env.EXPLAINER_LIVE_AWS_PROFILE ?? '' } },
});
const call = async (path: string, body?: unknown) => {
  const res = await fetch(app.url + path, body === undefined ? {} : { method: 'POST', headers: { 'x-explainer': '1', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
};
const job = async (path: string, body: unknown = {}) => {
  const t = Date.now();
  let j = await call(path, body);
  let last = '';
  while (j.status === 'queued' || j.status === 'running') {
    await new Promise((r) => setTimeout(r, 2000));
    j = await call(`/api/jobs/${j.id}`);
    const line = `${j.stage}${j.detail ? ` · ${j.detail}` : ''}`;
    if (line !== last) { console.log(`  ${path.split('/').pop()}: ${line}`); last = line; }
  }
  if (j.status !== 'succeeded') throw new Error(`${path} ${j.status}: ${j.error}\n${j.log.slice(-30).join('\n')}`);
  console.log(`${path.split('/').pop()} done in ${Math.round((Date.now() - t) / 1000)}s`);
};

try {
  const [style] = await call('/api/styles');
  console.log(`style: ${style.name} (${style.voice.voiceId})`);
  const e = await call('/api/explainers', {
    brief: 'What Rocket Explainer is, why styles are the product, and how the style loop works. A short overview, about 30 seconds.',
    sources: [{ value: join(repo, 'docs/intent/explainer.md') }, { value: join(repo, 'docs/research/prior-art.md') }],
    styleId: style.id, outputType: type,
  });
  await job(`/api/explainers/${e.id}/report`);
  await job(`/api/explainers/${e.id}/plan`);
  await call(`/api/explainers/${e.id}/approve`, {});
  await job(`/api/explainers/${e.id}/outputs/${type}/build`);
  let x = await call(`/api/explainers/${e.id}`);
  const r1 = x.outputs[type].rounds[0];
  const target = r1.scenes[Math.min(1, r1.scenes.length - 1)];
  await call(`/api/explainers/${e.id}/outputs/${type}/rounds/1/comments`, { text: 'Make the highlight on the key term bigger and hold it a beat longer.', sceneId: target.id });
  await job(`/api/explainers/${e.id}/outputs/${type}/rerender`);
  x = await call(`/api/explainers/${e.id}`);
  const r2 = x.outputs[type].rounds[1];
  for (const r of [r1, r2]) {
    const dir = join(x.id ? join(out, 'home', 'explainers', x.id, 'outputs', type, 'rounds', String(r.n)) : '');
    await copyFile(join(dir, r.files[0]), join(out, `round${r.n}-${r.files[0]}`));
  }
  console.log(JSON.stringify({
    title: x.title, report: x.report.overall, plan: x.plans.at(-1).plan.outline,
    round1: { scenes: r1.scenes.map((s: any) => `${s.id} ${s.title} (${s.durationMs}ms)`), durationMs: r1.durationMs },
    round2: { rendered: r2.rendered, narrated: r2.narrated, comment: target.id },
    files: [join(out, `round1-${r1.files[0]}`), join(out, `round2-${r2.files[0]}`)],
  }, null, 2));
} finally {
  await app.close();
}
