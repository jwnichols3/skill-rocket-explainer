import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import type { Renderer, RenderRequest, RenderResult } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { withBrowser, BROWSER_CHECK } from '../../browser.ts';
import { parseDesign } from '../../style/design.ts';
import { pagePrompt, PAGE_FILE } from './prompt.ts';

/** Canvas width in CSS px; the PNG is captured at SCALE x for crisp text. */
export const CANVAS_WIDTH = 1600;
export const MAX_HEIGHT = 6000;
export const SCALE = 2;
const PAGE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

export const VISUAL_CHECKS: CheckDef[] = [BROWSER_CHECK];

/** visual.json: where each panel sits on the canvas (CSS px), so the viewer can point at it. */
export interface VisualLayout {
  width: number;
  height: number;
  scale: number;
  panels: { id: string; x: number; y: number; width: number; height: number; hash: string }[];
}

const exists = (f: string) => access(f).then(() => true, () => false);

/** Contract problems visible in the source: not a document, scripts, anything that would load a URL. */
export function checkHtml(html: string): string[] {
  const problems: string[] = [];
  if (!/^\s*<!doctype html/i.test(html)) problems.push('the file must be a complete HTML document starting with <!doctype html>');
  if (/<script\b/i.test(html)) problems.push('remove every <script>: the page must be static HTML and CSS');
  if (/@import\b/i.test(html)) problems.push('remove @import: put all CSS inline');
  const ok = (v: string) => /^(#|data:)/i.test(v.trim());
  const refs = new Set<string>();
  for (const m of html.matchAll(/\s(?:src|href|xlink:href|srcset|poster|action|background)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const v = m[1] ?? m[2] ?? m[3] ?? '';
    if (!ok(v)) refs.add(v);
  }
  for (const m of html.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const v = m[1] ?? m[2] ?? m[3] ?? '';
    if (!ok(v)) refs.add(v);
  }
  for (const r of refs) problems.push(`remove the reference to "${r.slice(0, 120)}": only #fragment and data: URIs are allowed`);
  return problems;
}

interface Capture { problems: string[]; layout: VisualLayout }

/**
 * Loads the page at the canvas width (network and other files blocked, scripts off), checks the
 * panel contract in the DOM, records panel boxes, and screenshots the full page at SCALE x.
 * One browser session, so the boxes describe exactly the pixels captured.
 */
export async function capturePage(htmlFile: string, pngFile: string, ids: string[], width = CANVAS_WIDTH): Promise<Capture> {
  return withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: SCALE, javaScriptEnabled: false });
    const self = pathToFileURL(htmlFile).href;
    const blocked: string[] = [];
    await page.route('**/*', (r) => {
      const url = r.request().url();
      if (url === self || url.startsWith('data:')) return r.continue();
      blocked.push(url);
      return r.abort();
    });
    await page.goto(self, { waitUntil: 'load' });
    const dom = await page.evaluate((ids: string[]) => {
      const problems: string[] = [];
      const panels: { id: string; x: number; y: number; width: number; height: number; html: string }[] = [];
      for (const id of ids) {
        const els = [...document.querySelectorAll('[data-scene]')].filter((e) => e.getAttribute('data-scene') === id);
        if (els.length !== 1) { problems.push(`expected exactly one element with data-scene="${id}", found ${els.length}`); continue; }
        const el = els[0] as HTMLElement;
        if (el.id !== id) problems.push(`the element with data-scene="${id}" must also have id="${id}"`);
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) problems.push(`panel ${id} has no visible size`);
        panels.push({ id, x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height, html: el.outerHTML });
      }
      for (const el of document.querySelectorAll('[data-scene]')) {
        const v = el.getAttribute('data-scene') ?? '';
        if (!ids.includes(v)) problems.push(`data-scene="${v}" is not a panel id (panels: ${ids.join(', ')})`);
      }
      const d = document.documentElement;
      return { problems, panels, width: Math.max(d.scrollWidth, document.body?.scrollWidth ?? 0), height: Math.max(d.scrollHeight, document.body?.scrollHeight ?? 0) };
    }, ids);
    const problems = [...dom.problems, ...[...new Set(blocked)].map((u) => `the page tried to load ${u.slice(0, 160)}: it must be self-contained`)];
    if (dom.width > width) problems.push(`the page is ${dom.width} px wide; the canvas is ${width} px: nothing may overflow sideways`);
    if (dom.height > MAX_HEIGHT) problems.push(`the page is ${dom.height} px tall; the maximum is ${MAX_HEIGHT} px: tighten the layout`);
    const layout: VisualLayout = {
      width, height: Math.min(dom.height, MAX_HEIGHT), scale: SCALE,
      panels: dom.panels.map(({ html, ...p }) => ({ ...p, hash: createHash('sha256').update(html).digest('hex').slice(0, 16) })),
    };
    if (!problems.length) await page.screenshot({ path: pngFile, fullPage: true });
    return { problems, layout };
  });
}

/**
 * One-pager visual: one agent task composes the whole page as self-contained HTML (panel =
 * scene, `<section id=… data-scene=…>`), we check it and capture it to PNG at 2x with headless
 * Chromium. Re-renders hand the agent the previous page and the dirty panel ids to edit in place.
 * Outputs: visual.png (primary), visual.html, visual.json (panel boxes for the viewer).
 */
export function createVisualRenderer(): Renderer {
  return {
    id: 'html-visual',
    label: 'One-pager (HTML to PNG)',
    outputTypes: ['visual'],
    async render(req: RenderRequest): Promise<RenderResult> {
      if (req.outputType !== 'visual') throw new Error(`the one-pager renderer renders visual, not ${req.outputType}`);
      await mkdir(req.workdir, { recursive: true });
      const ids = req.scenes.map((s) => s.id);
      const html = join(req.workdir, PAGE_FILE);
      const png = join(req.workdir, 'visual.png');
      const json = join(req.workdir, 'visual.json');
      const previous = req.cacheDir && req.dirtyScenes && await exists(join(req.cacheDir, PAGE_FILE)) ? req.cacheDir : null;
      const dirty = previous ? ids.filter((id) => req.dirtyScenes!.includes(id)) : ids;

      let layout: VisualLayout;
      if (previous && !dirty.length) {
        await copyFile(join(previous, PAGE_FILE), html);
        const cap = await capturePage(html, png, ids);
        if (cap.problems.length) throw new Error(`the previous page no longer fits the panels: ${cap.problems.join('; ')}`);
        layout = cap.layout;
        req.onLog?.('no dirty panels: reused the previous page');
      } else {
        layout = await composePage(req, previous, dirty, html, png);
      }
      if (previous) await reportCleanPanels(previous, layout, dirty, req.onLog);
      await writeFile(json, JSON.stringify(layout, null, 2));
      return { primary: png, files: [png, html, json], sceneCount: req.scenes.length, rendered: dirty };
    },
  };
}

/** The agent writes the page; we check and capture it. One retry with the problems fed back. */
async function composePage(req: RenderRequest, previous: string | null, dirty: string[], html: string, png: string): Promise<VisualLayout> {
  if (!req.agent) throw new Error('the one-pager renderer needs an agent to write the page');
  const agent = req.agent;
  const ids = req.scenes.map((s) => s.id);
  let design: { tokens: Record<string, any>; sections: Record<string, string> } = { tokens: {}, sections: {} };
  try { design = parseDesign(req.style); } catch { /* the agent still gets the raw DESIGN.md */ }
  dirty.forEach((id, i) => req.onScene?.(id, i, dirty.length));

  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const dir = join(req.workdir, 'page', `attempt-${attempt}`);
    await mkdir(dir, { recursive: true });
    if (previous) await copyFile(join(previous, PAGE_FILE), join(dir, 'previous.html'));
    const failed = join(req.workdir, 'page', `attempt-${attempt - 1}`, PAGE_FILE);
    if (problems.length && await exists(failed)) await copyFile(failed, join(dir, 'failed-attempt.html'));
    req.onLog?.(`${previous ? 'revising' : 'composing'} the page${previous ? ` (panels ${dirty.join(', ')})` : ''}, attempt ${attempt}`);
    const res = await agent.surface.run({
      kind: 'visual-page',
      prompt: pagePrompt(CANVAS_WIDTH, MAX_HEIGHT),
      inputs: {
        title: req.title,
        panels: req.scenes.map((s) => ({ id: s.id, title: s.title, body: s.narration, visuals: s.visuals })),
        style: req.style,
        visualRules: design.sections.Visual ?? '',
        tokens: design.tokens,
        width: CANVAS_WIDTH, maxHeight: MAX_HEIGHT,
        mode: previous ? 'revise' : 'compose',
        dirty,
        comments: req.comments ?? [],
        ...(req.document ? { document: req.document } : {}),
        ...(problems.length ? { problems } : {}),
      },
      expectFiles: [PAGE_FILE],
      tools: PAGE_TOOLS,
    }, { workdir: dir, model: agent.model, effort: agent.effort, signal: req.signal, onLog: req.onLog });
    if (req.signal?.aborted) throw new Error('cancelled');
    if (!res.ok) problems = [`agent failed (${res.error.kind}): ${res.error.message}`];
    else if (!(await exists(join(dir, PAGE_FILE)))) problems = [`the agent did not write ${PAGE_FILE}`];
    else {
      await copyFile(join(dir, PAGE_FILE), html);
      problems = checkHtml(await readFile(html, 'utf8'));
      if (!problems.length) {
        const cap = await capturePage(html, png, ids);
        problems = cap.problems;
        if (!problems.length) {
          req.onLog?.(`captured ${cap.layout.width}x${cap.layout.height} at ${SCALE}x`);
          return cap.layout;
        }
      }
    }
    req.onLog?.(`page attempt ${attempt} failed: ${problems.join('; ')}`);
  }
  throw new Error(`the one-pager page failed its checks after a retry: ${problems.join('; ')}`);
}

/** Logs whether panels that were not dirty kept their markup (the agent is told to leave them alone). */
async function reportCleanPanels(previous: string, layout: VisualLayout, dirty: string[], log?: (l: string) => void) {
  let before: VisualLayout;
  try { before = JSON.parse(await readFile(join(previous, 'visual.json'), 'utf8')); } catch { return; }
  const changed = layout.panels.filter((p) => !dirty.includes(p.id) && before.panels.find((b) => b.id === p.id)?.hash !== p.hash).map((p) => p.id);
  if (changed.length) log?.(`note: panels ${changed.join(', ')} were not dirty but their markup changed`);
}
