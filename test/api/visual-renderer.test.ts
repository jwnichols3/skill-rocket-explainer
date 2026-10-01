import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TimedScene } from '../../src/providers/types.ts';
import { createVisualRenderer, checkHtml, capturePage, CANVAS_WIDTH, SCALE, type VisualLayout } from '../../src/providers/visual/renderer.ts';
import { createFakeAgent } from '../../src/providers/fake/agent.ts';
import '../../src/providers/fake/responders.ts';
import { designTemplate } from '../../src/style/design.ts';
import { CONTRACT_SCENES } from '../contracts/renderer.ts';
import { DEFAULT_SETTINGS } from '../../src/settings.ts';
import { providerChecks, validateProviders } from '../../src/providers/registry.ts';

const scenes: TimedScene[] = CONTRACT_SCENES.map((s) => ({ ...s, startMs: 0, durationMs: 0, words: [] }));
const style = designTemplate('neon blue/green, high contrast');
const agent = () => ({ surface: createFakeAgent(() => ({})), model: 'claude-opus-5-5', effort: 'high' });
const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
const layoutOf = async (file: string): Promise<VisualLayout> => JSON.parse(await readFile(file, 'utf8'));

test('selecting html-visual adds the headless-browser doctor check', () => {
  const s = { ...DEFAULT_SETTINGS, providers: { ...DEFAULT_SETTINGS.providers, renderer: { ...DEFAULT_SETTINGS.providers.renderer, visual: 'html-visual' } } };
  assert.ok(providerChecks(s).some((c) => c.id === 'headless-browser'));
  assert.equal(validateProviders({ renderer: { visual: 'html-visual' } } as any), null);
  assert.match(validateProviders({ renderer: { video: 'html-visual' } } as any) ?? '', /does not produce video/);
});

test('checkHtml flags scripts, imports and every URL that is not #fragment or data:', () => {
  assert.deepEqual(checkHtml('<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><use href="#a"/></svg><img src="data:image/png;base64,AA"></body></html>'), []);
  const p = checkHtml(`<html><head><link rel="stylesheet" href="https://fonts.example/x.css"><style>@import "y.css"; .a { background: url('//cdn.example/b.png') }</style><script>1</script></head><body><img src=logo.png></body></html>`);
  assert.equal(p.length, 6, p.join('\n'));
  assert.match(p.join('\n'), /doctype/);
  assert.match(p.join('\n'), /<script>/);
  assert.match(p.join('\n'), /@import/);
  for (const u of ['https://fonts.example/x.css', '//cdn.example/b.png', 'logo.png']) assert.ok(p.some((x) => x.includes(`"${u}"`)), `${u} not flagged`);
});

test('capture blocks and reports requests the source check cannot see, and does not screenshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-'));
  const html = join(dir, 'p.html');
  await writeFile(html, '<!doctype html><html><body style="margin:0"><section id="s1" data-scene="s1">Hi</section><object data="https://example.com/x.svg"></object></body></html>');
  const cap = await capturePage(html, join(dir, 'p.png'), ['s1']);
  assert.ok(cap.problems.some((p) => p.includes('tried to load https://example.com/x.svg')), cap.problems.join('\n'));
  assert.ok(!(await readdir(dir)).includes('p.png'));
});

test('one-pager: one element per panel id, no external URLs, PNG is the canvas at 2x, panel boxes recorded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-'));
  const r = await createVisualRenderer().render({ outputType: 'visual', style, title: 'Packets', scenes, workdir: join(dir, 'r1'), agent: agent() });
  assert.deepEqual(r.files.map((f) => f.split('/').pop()), ['visual.png', 'visual.html', 'visual.json']);
  assert.equal(r.primary, r.files[0]);
  assert.deepEqual(r.rendered, ['s1', 's2', 's3']);
  const html = await readFile(r.files[1], 'utf8');
  for (const s of scenes) {
    assert.equal(html.match(new RegExp(`data-scene="${s.id}"`, 'g'))?.length, 1, `data-scene ${s.id}`);
    assert.equal(html.match(new RegExp(`id="${s.id}"`, 'g'))?.length, 1, `id ${s.id}`);
  }
  assert.deepEqual(checkHtml(html), []);
  assert.doesNotMatch(html, /https?:\/\//);
  const layout = await layoutOf(r.files[2]);
  assert.equal(layout.width, CANVAS_WIDTH);
  assert.equal(layout.scale, SCALE);
  assert.deepEqual(layout.panels.map((p) => p.id), ['s1', 's2', 's3']);
  for (const p of layout.panels) assert.ok(p.width > 0 && p.height > 0 && p.x >= 0 && p.y + p.height <= layout.height, JSON.stringify(p));
  assert.deepEqual(pngSize(await readFile(r.primary)), { width: CANVAS_WIDTH * SCALE, height: layout.height * SCALE });
});

test('re-render: the agent revises the previous page for the dirty panel only; clean panels keep their markup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-'));
  const first = await createVisualRenderer().render({ outputType: 'visual', style, title: 'Packets', scenes, workdir: join(dir, 'r1'), agent: agent() });
  const changed = scenes.map((s) => (s.id === 's2' ? { ...s, visuals: `${s.visuals} [revised: bigger boxes]` } : s));
  const logs: string[] = [];
  const second = await createVisualRenderer().render({ outputType: 'visual', style, title: 'Packets', scenes: changed, workdir: join(dir, 'r2'),
    cacheDir: join(dir, 'r1'), dirtyScenes: ['s2'], agent: agent(), onLog: (l) => logs.push(l) });
  assert.deepEqual(second.rendered, ['s2']);
  const work = join(dir, 'r2', 'page', 'attempt-1');
  const inputs = JSON.parse(await readFile(join(work, 'inputs.json'), 'utf8'));
  assert.equal(inputs.mode, 'revise');
  assert.deepEqual(inputs.dirty, ['s2']);
  assert.match(inputs.visualRules, /one-pager/);
  assert.ok((await readdir(work)).includes('previous.html'));
  const [a, b] = await Promise.all([layoutOf(first.files[2]), layoutOf(second.files[2])]);
  const hash = (l: VisualLayout, id: string) => l.panels.find((p) => p.id === id)!.hash;
  assert.equal(hash(a, 's1'), hash(b, 's1'));
  assert.equal(hash(a, 's3'), hash(b, 's3'));
  assert.notEqual(hash(a, 's2'), hash(b, 's2'));
  assert.ok(!logs.some((l) => l.includes('were not dirty')), logs.join('\n'));
  assert.match(await readFile(second.files[1], 'utf8'), /bigger boxes/);
});

test('a page that loads an external URL is sent back once with the problems, then passes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-'));
  const bad = scenes.map((s, i) => (i === 1 ? { ...s, visuals: `${s.visuals} [fake: external once]` } : s));
  const logs: string[] = [];
  const r = await createVisualRenderer().render({ outputType: 'visual', style, title: 'Packets', scenes: bad, workdir: join(dir, 'r'), agent: agent(), onLog: (l) => logs.push(l) });
  assert.ok(logs.some((l) => /page attempt 1 failed: .*example\.com/.test(l)), logs.join('\n'));
  const retry = join(dir, 'r', 'page', 'attempt-2');
  const inputs = JSON.parse(await readFile(join(retry, 'inputs.json'), 'utf8'));
  assert.ok(inputs.problems.some((p: string) => p.includes('https://example.com/logo.png')), inputs.problems.join('\n'));
  assert.ok((await readdir(retry)).includes('failed-attempt.html'));
  assert.doesNotMatch(await readFile(r.files[1], 'utf8'), /example\.com/);
});

test('a page missing a panel fails after the retry with the DOM problem', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'visual-'));
  // The fake agent draws only the panels it is given; drop s3 so the page never has it.
  const fake = createFakeAgent(() => ({}));
  const surface = { ...fake, run: (task: any, opts: any) => fake.run({ ...task, inputs: { ...task.inputs, panels: task.inputs.panels.slice(0, 2) } }, opts) };
  await assert.rejects(
    createVisualRenderer().render({ outputType: 'visual', style, title: 'Packets', scenes, workdir: join(dir, 'r'), agent: { surface, model: 'm', effort: 'e' } }),
    /after a retry: expected exactly one element with data-scene="s3", found 0/);
});
