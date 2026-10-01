// Deck renderer (html-deck): HTML slides + editable .pptx. The fake agent supplies slide HTML and
// models, so this runs without a model; it needs the headless browser (like browser.test.ts).
// The shared contract runs (fake agent, and a LIVE=1 real-model run) are in contract-renderer.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { AgentSurface, AgentTask, TimedScene } from '../../src/providers/types.ts';
import { createDeckRenderer } from '../../src/providers/deck/renderer.ts';
import { parseSlideModel, tokensFrom } from '../../src/providers/deck/model.ts';
import { checkSlideHtml } from '../../src/providers/deck/html.ts';
import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { designTemplate, parseDesign } from '../../src/style/design.ts';
import { CONTRACT_SCENES } from '../contracts/renderer.ts';
import { startTestApp, waitForJob, approvedExplainer, post } from '../helpers/app.ts';

const style = designTemplate('neon blue/green, high contrast');
const scenes = (): TimedScene[] => CONTRACT_SCENES.map((s) => ({ ...s, startMs: 0, durationMs: 0, words: [] }));

/** The fake agent, recording each task it runs. */
function recordingAgent(calls: AgentTask[] = []): AgentSurface {
  const fake = createFakeAgent(() => ({}));
  return { ...fake, run: (task, opts) => { calls.push(task); return fake.run(task, opts); } };
}
const agentOf = (surface: AgentSurface) => ({ surface, model: 'claude-opus-5-5', effort: 'high' });

/** Entries of a zip (stored or deflated), by name. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name, method === 8 ? inflateRawSync(data) : data);
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function deckFiles(primary: string) {
  const html = await readFile(primary, 'utf8');
  const zip = unzip(await readFile(join(dirname(primary), 'deck.pptx')));
  return { html, zip, slideXml: (n: number) => zip.get(`ppt/slides/slide${n}.xml`)?.toString() ?? '' };
}

test('[html-deck] one section per slide anchored by scene id; the .pptx has one native, editable slide per scene', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-'));
  const r = await createDeckRenderer().render({ outputType: 'deck', style, title: 'Packets', scenes: scenes(), workdir: dir, agent: agentOf(recordingAgent()) });
  assert.deepEqual(r.rendered, ['s1', 's2', 's3']);
  assert.deepEqual(r.files.map((f) => f.split('/').pop()), ['deck.html', 'deck.pptx']);
  const { html, zip, slideXml } = await deckFiles(r.primary);
  assert.deepEqual([...html.matchAll(/<section class="slide" id="([^"]+)"/g)].map((m) => m[1]), ['s1', 's2', 's3']);
  assert.doesNotMatch(html, /https?:\/\//, 'deck.html must not reference the network');
  assert.ok(['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/slide3.xml'].every((f) => zip.has(f)), [...zip.keys()].join(', '));
  assert.ok(!zip.has('ppt/slides/slide4.xml'));
  const s1 = slideXml(1);
  assert.match(s1, /<a:t>Opening<\/a:t>/, 'slide title is native text');
  assert.match(s1, /prstGeom prst="roundRect"/, 'boxes are native shapes');
  assert.match(s1, /srgbClr val="4FD1C5"/, 'colours come from the style tokens');
  assert.match(s1, /typeface="Inter"/, 'fonts come from the style tokens');
  assert.doesNotMatch(s1, /<p:pic>/, 'no pictures when the model expresses everything');
  const notes = [...zip.entries()].filter(([k]) => k.startsWith('ppt/notesSlides/')).map(([, v]) => v.toString()).join('');
  assert.match(notes, /Every message you send starts a journey\./, 'body text becomes speaker notes');
});

test('[html-deck] given the previous render, only dirty slides are regenerated; clean slides are reused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-'));
  const first = await createDeckRenderer().render({ outputType: 'deck', style, title: 'Packets', scenes: scenes(), workdir: join(dir, 'r1'), agent: agentOf(recordingAgent()) });
  const calls: AgentTask[] = [];
  const changed = scenes().map((s) => (s.id === 's2' ? { ...s, title: 'Packets, revised' } : s));
  const progress: string[] = [];
  const second = await createDeckRenderer().render({ outputType: 'deck', style, title: 'Packets', scenes: changed, workdir: join(dir, 'r2'),
    cacheDir: join(dir, 'r1'), dirtyScenes: ['s2'], agent: agentOf(recordingAgent(calls)), onScene: (id) => progress.push(id) });
  assert.deepEqual(second.rendered, ['s2']);
  assert.deepEqual(progress, ['s2']);
  assert.deepEqual(calls.map((c) => (c.inputs as any).slide.id), ['s2']);
  assert.equal(await readFile(join(dir, 'r2', 'slides', 's1.html'), 'utf8'), await readFile(join(dir, 'r1', 'slides', 's1.html'), 'utf8'));
  const a = await deckFiles(first.primary), b = await deckFiles(second.primary);
  assert.match(b.slideXml(2), /Packets, revised/);
  assert.equal(b.slideXml(1), a.slideXml(1));
  assert.equal([...b.html.matchAll(/<section class="slide"/g)].length, 3);
});

test('[html-deck] an invalid slide model is retried once with the problems fed back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-'));
  const calls: AgentTask[] = [];
  const s = scenes().slice(0, 2);
  s[1] = { ...s[1], visuals: `${s[1].visuals} [fake: broken once]` };
  const logs: string[] = [];
  const r = await createDeckRenderer().render({ outputType: 'deck', style, title: 'Retry', scenes: s, workdir: dir, agent: agentOf(recordingAgent(calls)), onLog: (l) => logs.push(l) });
  assert.deepEqual(r.rendered, ['s1', 's2']);
  assert.ok(logs.some((l) => l.includes('writing slide s2 (attempt 2)')), logs.join('\n'));
  assert.match(String((calls.at(-1)!.inputs as any).previousError), /type "sparkle"/);
  assert.match((await deckFiles(r.primary)).slideXml(2), /<a:t>Packets<\/a:t>/);
});

test('[html-deck] a model that stays invalid falls back to a full-slide picture in the .pptx, and says so', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-'));
  const s = scenes().slice(0, 2);
  s[1] = { ...s[1], visuals: `${s[1].visuals} [fake: no model]` };
  const logs: string[] = [];
  const r = await createDeckRenderer().render({ outputType: 'deck', style, title: 'Fallback', scenes: s, workdir: dir, agent: agentOf(recordingAgent()), onLog: (l) => logs.push(l) });
  const { slideXml, zip } = await deckFiles(r.primary);
  assert.doesNotMatch(slideXml(1), /<p:pic>/);
  assert.match(slideXml(2), /<p:pic>/);
  assert.ok([...zip.keys()].some((k) => /^ppt\/media\/.+\.png$/.test(k)));
  assert.ok(logs.some((l) => /s2 is a picture/.test(l)), logs.join('\n'));
});

test('[html-deck] text cut off at the slide edge is fed back for a retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deck-'));
  const tasks: AgentTask[] = [];
  const surface: AgentSurface = { id: 'stub', label: 'stub', async run(task, opts) {
    tasks.push(task);
    const i = task.inputs as any;
    const left = i.previousError ? 120 : 1700;
    await mkdir(join(opts.workdir, 'slides'), { recursive: true });
    await writeFile(join(opts.workdir, i.files.html), `<!doctype html><html><body style="margin:0;width:1920px;height:1080px;overflow:hidden"><h1 style="position:absolute;left:${left}px;top:100px;margin:0;font:80px sans-serif;white-space:nowrap">A long slide title</h1></body></html>`);
    await writeFile(join(opts.workdir, i.files.json), JSON.stringify({ elements: [{ type: 'text', x: left, y: 100, w: 800, h: 100, text: 'A long slide title', size: 80 }] }));
    return { ok: true, output: null, usage: {} };
  } };
  await createDeckRenderer().render({ outputType: 'deck', style, title: 'Cut', scenes: scenes().slice(0, 1), workdir: dir, agent: agentOf(surface) });
  assert.equal(tasks.length, 2);
  assert.match(String((tasks[1].inputs as any).previousError), /cut off.*A long slide title/);
});

test('[html-deck] slide model: tokens resolve, problems are specific', () => {
  const tokens = tokensFrom(parseDesign(style).tokens);
  const ok = parseSlideModel({ background: 'surface', elements: [{ type: 'text', x: 0, y: 0, w: 100, h: 50, text: 'Hi', font: 'display', color: '#abc' }] }, tokens);
  assert.ok(ok.model);
  assert.equal(ok.model.background, '141A22');
  assert.deepEqual(ok.model.elements[0], { type: 'text', text: 'Hi', x: 0, y: 0, w: 100, h: 50, font: 'Inter', size: 32, color: 'AABBCC', bold: true, italic: false, align: 'left', valign: 'top' });
  // The resolved model (what the renderer stores) parses to itself, even without the tokens.
  assert.deepEqual(parseSlideModel(JSON.parse(JSON.stringify(ok.model)), { colors: {}, fonts: {} }).model, ok.model);
  const bad = parseSlideModel({ elements: [{ type: 'text', x: 0, y: 0, w: 100, text: 'Hi', color: 'hotpink' }, { type: 'shape', shape: 'star', x: 0, y: 0, w: 1, h: 1 }] }, tokens);
  assert.equal(bad.model, null);
  assert.ok(bad.problems.some((p) => p.includes('elements[0].h')), bad.problems.join('\n'));
  assert.ok(bad.problems.some((p) => p.includes('"hotpink" is neither a colour token')), bad.problems.join('\n'));
  assert.ok(bad.problems.some((p) => p.includes('elements[1].shape')), bad.problems.join('\n'));
  const table = (colW: unknown) => parseSlideModel({ elements: [{ type: 'table', x: 0, y: 0, w: 900, h: 200, rows: [['a', 'b', 'c']], colW }] }, tokens);
  assert.deepEqual((table([300, 200, 400]).model?.elements[0] as any).colW, [300, 200, 400]);
  assert.match(table([300, 600]).problems.join(), /colW must list 3 positive column widths/);
});

test('[html-deck] slide HTML: scripts and remote resources are rejected', () => {
  assert.deepEqual(checkSlideHtml('<html><body><h1>Hi</h1></body></html>'), []);
  assert.match(checkSlideHtml('<html><head><link rel="stylesheet" href="https://fonts.example.com/x.css"></head><body><h1>Hi</h1></body></html>').join(), /remote resource/);
  assert.match(checkSlideHtml('<html><body style="background:url(//cdn.example.com/a.png)"><h1>Hi</h1></body></html>').join(), /remote resource/);
  assert.match(checkSlideHtml('<html><body><h1>Hi</h1><script>1</script></body></html>').join(), /<script>/);
});

test('[html-deck] in the app: build, slide-pinned comment re-renders only that slide; the style deck sample loop works', async () => {
  const app = await startTestApp({ providers: { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'html-deck', doc: 'fake', visual: 'fake' } } });
  try {
    const { id } = await approvedExplainer(app, 'deck');
    const j = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/deck/build`, post({}))).id);
    assert.equal(j.status, 'succeeded', j.error);
    await app.json(`/api/explainers/${id}/outputs/deck/rounds/1/comments`, post({ text: 'tighter', sceneId: 's2' }));
    const j2 = await waitForJob(app, (await app.json(`/api/explainers/${id}/outputs/deck/rerender`, post({}))).id);
    assert.equal(j2.status, 'succeeded', j2.error);
    const e = await app.json(`/api/explainers/${id}`);
    const r2 = e.outputs.deck.rounds[1];
    assert.deepEqual(r2.files, ['deck.html', 'deck.pptx']);
    assert.deepEqual(r2.rendered, ['s2']);
    assert.match(await (await app.api(r2.url)).text(), /<section class="slide" id="s2"/);

    const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
    await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
    const js = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({ outputType: 'deck' }))).id);
    assert.equal(js.status, 'succeeded', js.error);
    await app.json(`/api/styles/${s.id}/rounds/2/comments`, post({ text: 'bigger slide titles' }));
    const jr = await waitForJob(app, (await app.json(`/api/styles/${s.id}/rerender`, post({}))).id);
    assert.equal(jr.status, 'succeeded', jr.error);
    const style2 = await app.json(`/api/styles/${s.id}`);
    assert.equal(style2.rounds[2].outputType, 'deck');
    assert.deepEqual(style2.rounds[2].fileUrls.map((u: string) => u.split('/').pop()), ['sample.html', 'sample.pptx']);
    assert.match(style2.design, /bigger slide titles/);
  } finally {
    await app.stop();
  }
});
