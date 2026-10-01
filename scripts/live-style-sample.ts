/**
 * Live end-to-end check of a style sample on the real Claude agent (claude-subscription).
 *
 * Starts the app on a free port with a throwaway data dir (kept afterwards for inspection),
 * creates a style, runs one sample round and prints the round summary, the head of the
 * produced DESIGN.md and the scene list. TTS and the video renderer are the fakes, so only
 * the agent is real. Needs Claude Code installed and logged in to a Claude subscription.
 *
 *   node scripts/live-style-sample.ts
 *
 * Env: MODEL (default claude-opus-5-5), EFFORT (default high), AGENT (default claude-subscription).
 * Costs subscription usage and takes a few minutes at the defaults.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.ts';

const model = process.env.MODEL ?? 'claude-opus-5-5';
const effort = process.env.EFFORT ?? 'high';
const agent = process.env.AGENT ?? 'claude-subscription';
const DESCRIPTION = "Hitchhiker's Guide animations, smooth transitions, camera movement, on-screen highlights, neon blue/green, high contrast, lively, room for humor";

const home = await mkdtemp(join(tmpdir(), 'explainer-live-'));
const server = await startServer({
  home, port: 0,
  settings: { providers: { agent, tts: 'fake', renderer: { video: 'fake' } } },
});
console.log(`data dir: ${home}\nagent: ${agent} · ${model} · ${effort}\n`);

async function api(path: string, body?: unknown): Promise<any> {
  const init: RequestInit = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-explainer': '1' } };
  const res = await fetch(server.url + path, init);
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

let code = 0;
try {
  const style = await api('/api/styles', { description: DESCRIPTION, voice: { provider: 'fake', voiceId: 'fake-bright' }, model, effort });
  const started = Date.now();
  const job = await api(`/api/styles/${style.id}/sample`, {});
  let shown = 0;
  let state: any;
  for (;;) {
    state = await api(`/api/jobs/${job.id}`);
    for (const line of state.log.slice(shown)) console.log(`  ${line}`);
    shown = state.log.length;
    if (state.status !== 'queued' && state.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`\njob ${state.status} in ${Math.round((Date.now() - started) / 1000)} s`);
  if (state.status !== 'succeeded') throw new Error(state.error ?? state.status);

  const view = await api(`/api/styles/${style.id}`);
  const round = view.rounds.at(-1);
  console.log(`\n== Round ${round.n} summary\n${round.summary}`);
  console.log(`\n== Usage\n${JSON.stringify(round.usage)}`);
  console.log(`\n== DESIGN.md (first 30 lines)\n${view.design.split('\n').slice(0, 30).join('\n')}`);
  console.log(`\n== Scenes`);
  for (const s of round.scenes) console.log(`${s.id}  ${s.title}  [${(s.elements ?? []).join(', ')}]\n    "${s.narration}"`);
} catch (err: any) {
  console.error(`\nFAILED: ${err?.message ?? err}`);
  code = 1;
} finally {
  await server.close();
}
process.exit(code);
