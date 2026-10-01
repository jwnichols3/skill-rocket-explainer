import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentSurface, AgentTask, TimedScene } from '../../src/providers/types.ts';
import { createDocRenderer } from '../../src/providers/doc/renderer.ts';
import { demoteHeadings } from '../../src/providers/doc/markdown.ts';
import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { designTemplate } from '../../src/style/design.ts';
import { CONTRACT_SCENES } from '../contracts/renderer.ts';
import { startTestApp, waitForJob, approvedExplainer, post } from '../helpers/app.ts';

const STYLE = designTemplate('neon blue/green, high contrast');
const scenes = (): TimedScene[] => CONTRACT_SCENES.map((s) => ({ ...s, startMs: 0, durationMs: 0, words: [] }));

/** The fake agent, recording each task; `fail(kind, n)` makes the first n runs of a kind fail. */
function recordingAgent(failures: Record<string, number> = {}) {
  const calls: AgentTask[] = [];
  const inner = createFakeAgent(() => ({}));
  const surface: AgentSurface = {
    id: 'recording', label: 'recording',
    async run(task, opts) {
      calls.push(task);
      if ((failures[task.kind] ?? 0) > 0) { failures[task.kind]--; return { ok: false, error: { kind: 'failed', message: `planned failure of ${task.kind}` } }; }
      return inner.run(task, opts);
    },
  };
  return { calls, agent: { surface, model: 'claude-opus-5-5', effort: 'high' } };
}

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

test('doc: one ## section per scene in order, anchored, styled by the agent stylesheet with the style colors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'doc-'));
  const { calls, agent } = recordingAgent();
  const r = await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Packets', scenes: scenes(), workdir: dir, agent });
  assert.equal(r.primary, join(dir, 'doc.pdf'));
  assert.deepEqual(r.files, [join(dir, 'doc.pdf'), join(dir, 'doc.md')]);
  assert.deepEqual(r.rendered, ['s1', 's2', 's3']);
  const md = await readFile(join(dir, 'doc.md'), 'utf8');
  assert.match(md, /^# Packets\n/);
  assert.deepEqual(md.split('\n').filter((l) => l.startsWith('## ')), CONTRACT_SCENES.map((s) => `## <a id="${s.id}"></a>${s.title}`));
  assert.match(md, /> \*\*Key point:\*\* One box splits into four/, 'figures from the agent follow the body');
  const html = await readFile(join(dir, 'doc.html'), 'utf8');
  assert.match(html, /fake doc-stylesheet/, 'the agent-written stylesheet is embedded');
  for (const color of ['#0b0f14', '#4fd1c5', '#f6e05e']) assert.ok(html.includes(color), `style color ${color} in the HTML/CSS`);
  assert.ok(html.includes('content: "Packets"'), 'the title placeholder is filled in the page header');
  assert.deepEqual(calls.map((c) => c.kind).sort(), ['doc-figures', 'doc-stylesheet']);
  const css = calls.find((c) => c.kind === 'doc-stylesheet')!;
  assert.deepEqual(css.expectFiles, ['doc.css']);
  assert.ok(!css.tools!.includes('Bash'), 'file tools only');
  const pdf = await readFile(join(dir, 'doc.pdf'));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  for (const s of CONTRACT_SCENES) assert.ok(pdf.toString('latin1').includes(`/${s.id}`), `named destination ${s.id} in the PDF`);
});

test('doc: a long input paginates to more than one page', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'doc-long-'));
  const long = scenes().map((s) => ({ ...s, narration: Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${s.narration} `.repeat(6)).join('\n\n') }));
  const r = await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Long', scenes: long, workdir: dir, agent: recordingAgent().agent });
  assert.ok(pageCount(await readFile(r.primary)) > 1);
});

test('doc: a failed stylesheet is retried once with the error, then falls back to the token stylesheet', async () => {
  const once = recordingAgent({ 'doc-stylesheet': 1 });
  const d1 = await mkdtemp(join(tmpdir(), 'doc-retry-'));
  await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Retry', scenes: scenes(), workdir: d1, agent: once.agent });
  const tries = once.calls.filter((c) => c.kind === 'doc-stylesheet');
  assert.equal(tries.length, 2);
  assert.match(String(tries[1].inputs.previousError), /planned failure/);
  assert.match(await readFile(join(d1, 'doc.css'), 'utf8'), /fake doc-stylesheet/);

  const twice = recordingAgent({ 'doc-stylesheet': 2, 'doc-figures': 2 });
  const d2 = await mkdtemp(join(tmpdir(), 'doc-fallback-'));
  const logs: string[] = [];
  const r = await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Fallback', scenes: scenes(), workdir: d2, agent: twice.agent, onLog: (l) => logs.push(l) });
  const html = await readFile(join(d2, 'doc.html'), 'utf8');
  assert.match(html, /Fallback briefing-doc stylesheet/);
  assert.ok(html.includes('#4fd1c5'));
  assert.match(await readFile(join(d2, 'doc.md'), 'utf8'), /> \*\*Figure:\*\* One box splits into four/);
  assert.ok(logs.some((l) => /fallback/.test(l)), logs.join('\n'));
  assert.equal((await readFile(r.primary)).subarray(0, 5).toString(), '%PDF-');
});

test('doc: re-render reuses the stylesheet and clean sections\' figures; reports the dirty sections', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'doc-cache-'));
  const first = recordingAgent();
  await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Cache', scenes: scenes(), workdir: join(dir, 'r1'), agent: first.agent });
  const second = recordingAgent();
  const changed = scenes().map((s) => (s.id === 's2' ? { ...s, visuals: 'A comparison table of queues and streams' } : s));
  const r = await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Cache', scenes: changed, workdir: join(dir, 'r2'), cacheDir: join(dir, 'r1'), dirtyScenes: ['s2'], agent: second.agent });
  assert.deepEqual(r.rendered, ['s2']);
  assert.deepEqual(second.calls.map((c) => c.kind), ['doc-figures'], 'no stylesheet run for an unchanged style');
  assert.deepEqual((second.calls[0].inputs.sections as any[]).map((s) => s.id), ['s2']);
  const md = await readFile(join(dir, 'r2', 'doc.md'), 'utf8');
  assert.match(md, /\| Queue \| Buffers work \|/);
  assert.match(md, /Key point:\*\* A title card slams in/, 'clean sections keep their figures');

  // A changed style gets a new stylesheet; the shared cache serves a style seen before in another explainer.
  const shared = join(dir, 'shared');
  const a = recordingAgent();
  await createDocRenderer({ cacheRoot: shared }).render({ outputType: 'doc', style: STYLE + '\n<!-- v2 -->\n', title: 'A', scenes: scenes(), workdir: join(dir, 'a'), cacheDir: join(dir, 'r1'), agent: a.agent });
  assert.ok(a.calls.some((c) => c.kind === 'doc-stylesheet'));
  const b = recordingAgent();
  await createDocRenderer({ cacheRoot: shared }).render({ outputType: 'doc', style: STYLE + '\n<!-- v2 -->\n', title: 'B', scenes: scenes(), workdir: join(dir, 'b'), agent: b.agent });
  assert.ok(!b.calls.some((c) => c.kind === 'doc-stylesheet'));
});

test('doc: headings in body text are demoted and raw HTML is shown as text', async () => {
  assert.equal(demoteHeadings('# Big\n\nText\n\nSetext\n---\n\n### Kept'), '### Big\n\nText\n\n### Setext\n\n### Kept');
  const dir = await mkdtemp(join(tmpdir(), 'doc-sanitize-'));
  const odd = scenes().map((s, i) => (i === 0 ? { ...s, narration: '## Sneaky\n\n<script>alert(1)</script> and <b>bold</b>' } : s));
  await createDocRenderer().render({ outputType: 'doc', style: STYLE, title: 'Odd', scenes: odd, workdir: dir });
  const md = await readFile(join(dir, 'doc.md'), 'utf8');
  assert.equal(md.split('\n').filter((l) => l.startsWith('## ')).length, 3);
  const html = await readFile(join(dir, 'doc.html'), 'utf8');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('doc: explainer build, section-pinned re-render and an on-demand style doc sample with the markdown-pdf renderer', async () => {
  const app = await startTestApp({ providers: { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'fake', doc: 'markdown-pdf', visual: 'fake' } } });
  try {
    const { id } = await approvedExplainer(app, 'doc');
    const j = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/doc/build`, post({}))).id);
    assert.equal(j.status, 'succeeded', j.error);
    let e = await app.json(`/api/explainers/${id}`);
    assert.deepEqual(e.outputs.doc.rounds[0].files, ['doc.pdf', 'doc.md']);
    assert.match((await app.api(e.outputs.doc.rounds[0].url)).headers.get('content-type') ?? '', /application\/pdf/);
    await app.json(`/api/explainers/${id}/outputs/doc/rounds/1/comments`, post({ text: 'add a table', sceneId: 's2' }));
    const j2 = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/doc/rerender`, post({}))).id);
    assert.equal(j2.status, 'succeeded', j2.error);
    e = await app.json(`/api/explainers/${id}`);
    assert.deepEqual(e.outputs.doc.rounds[1].rendered, ['s2']);
    const md = await (await app.api(e.outputs.doc.rounds[1].fileUrls[1])).text();
    assert.match(md, /add a table/);

    const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
    await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
    const js = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({ outputType: 'doc' }))).id);
    assert.equal(js.status, 'succeeded', js.error);
    const style = await app.json(`/api/styles/${s.id}`);
    assert.deepEqual(style.rounds[1].files, ['sample.pdf', 'sample.md']);
  } finally {
    await app.stop();
  }
});
