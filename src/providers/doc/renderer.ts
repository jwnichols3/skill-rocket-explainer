import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Renderer, RenderRequest, RenderResult, TimedScene, AgentTask } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { BROWSER_CHECK, htmlToPdf } from '../../browser.ts';
import { parseDesign } from '../../style/design.ts';
import { docHtml, docMarkdown, type DocSection } from './markdown.ts';
import { fallbackStylesheet, fillTitle, styleHash, validateCss } from './stylesheet.ts';
import { CSS_FILE, figuresPrompt, stylesheetPrompt } from './prompt.ts';

/** File tools only: the agent reads inputs and writes one file; no shell, no web. */
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];

export const DOC_CHECKS: CheckDef[] = [BROWSER_CHECK];

/** Stylesheets shared across explainers, keyed by style hash. */
export const docCacheRoot = (home: string) => join(home, 'cache', 'doc-stylesheets');

export interface DocRendererOptions {
  /** Shared stylesheet cache across explainers, e.g. <home>/cache/doc-stylesheets. Optional. */
  cacheRoot?: string;
}

const readText = (f: string) => readFile(f, 'utf8').catch(() => null);
const readJson = async (f: string) => { const t = await readText(f); try { return t ? JSON.parse(t) : null; } catch { return null; } };

function docRules(style: string): string {
  try { return parseDesign(style).sections.Doc ?? ''; } catch { return ''; }
}

/**
 * Briefing doc renderer: Markdown assembled from the script, styled by a print stylesheet an
 * agent writes once per style, rendered to PDF by headless Chromium. Section text is final in the
 * script, so the whole doc is regenerated each time; only the agent work is cached (stylesheet by
 * style hash, figures per section by content).
 */
export function createDocRenderer(opts: DocRendererOptions = {}): Renderer {
  return {
    id: 'markdown-pdf',
    label: 'Briefing doc (Markdown to PDF)',
    outputTypes: ['doc'],
    async render(req: RenderRequest): Promise<RenderResult> {
      if (req.outputType !== 'doc') throw new Error(`the briefing-doc renderer renders doc, not ${req.outputType}`);
      await mkdir(req.workdir, { recursive: true });
      const [css, figures] = await Promise.all([ensureStylesheet(req, opts), ensureFigures(req)]);
      const sections: DocSection[] = req.scenes.map((s, i) => {
        req.onScene?.(s.id, i, req.scenes.length);
        return { id: s.id, title: s.title, body: s.narration, figures: figures[s.id]?.markdown ?? '' };
      });
      const md = join(req.workdir, 'doc.md');
      await writeFile(md, docMarkdown(req.title, sections));
      const html = join(req.workdir, 'doc.html');
      await writeFile(html, docHtml(req.title, sections, fillTitle(css, req.title)));
      if (req.signal?.aborted) throw new Error('cancelled');
      const pdf = join(req.workdir, 'doc.pdf');
      await htmlToPdf(html, pdf);
      req.onLog?.(`rendered doc: ${sections.length} sections`);
      return { primary: pdf, files: [pdf, md], sceneCount: req.scenes.length, rendered: req.dirtyScenes ?? req.scenes.map((s) => s.id) };
    },
  };
}

/** Runs an agent task up to twice, feeding the first failure back; returns null after two failures. */
async function attempt<T>(req: RenderRequest, name: string, task: (previousError?: string) => AgentTask, check: (dir: string, output: any) => Promise<T>, prepare?: (dir: string) => Promise<void>): Promise<T | null> {
  const agent = req.agent!;
  let previousError: string | undefined;
  for (let n = 1; n <= 2; n++) {
    const dir = join(req.workdir, 'agent', name, `attempt-${n}`);
    try {
      await mkdir(dir, { recursive: true });
      await prepare?.(dir);
      const res = await agent.surface.run(task(previousError), { workdir: dir, model: agent.model, effort: agent.effort, signal: req.signal, onLog: req.onLog });
      if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
      return await check(dir, res.output);
    } catch (err: any) {
      if (req.signal?.aborted) throw err;
      previousError = String(err?.message ?? err);
      req.onLog?.(`doc ${name} attempt ${n} failed: ${previousError.split('\n')[0]}`);
    }
  }
  return null;
}

// ---------- Stylesheet: one per style ----------

interface CssMeta { hash: string; source: 'agent' | 'fallback' }

async function ensureStylesheet(req: RenderRequest, opts: DocRendererOptions): Promise<string> {
  const hash = styleHash(req.style);
  const out = join(req.workdir, CSS_FILE);
  const save = async (css: string, source: CssMeta['source']) => {
    await writeFile(out, css);
    await writeFile(join(req.workdir, `${CSS_FILE}.json`), JSON.stringify({ hash, source } satisfies CssMeta));
    return css;
  };

  const prev: CssMeta | null = req.cacheDir ? await readJson(join(req.cacheDir, `${CSS_FILE}.json`)) : null;
  const prevCss = prev?.hash === hash && prev.source === 'agent' ? await readText(join(req.cacheDir!, CSS_FILE)) : null;
  const sharedCss = opts.cacheRoot ? await readText(join(opts.cacheRoot, `${hash}.css`)) : null;
  const cached = prevCss ?? sharedCss;
  if (cached && !validateCss(cached).length) {
    req.onLog?.(`doc stylesheet reused (style ${hash})`);
    return save(cached, 'agent');
  }

  if (req.agent) {
    const structure = docHtml(req.title, [...req.scenes.map((s) => ({ id: s.id, title: s.title, body: s.narration, figures: fallbackFigure(s) })), STRUCTURE_SAMPLE], '/* your doc.css goes here */');
    const css = await attempt(req, 'stylesheet', (previousError) => ({
      kind: 'doc-stylesheet',
      prompt: stylesheetPrompt(),
      inputs: { style: req.style, docRules: docRules(req.style), ...(previousError ? { previousError } : {}) },
      expectFiles: [CSS_FILE],
      tools: FILE_TOOLS,
    }), async (dir) => {
      const text = await readFile(join(dir, CSS_FILE), 'utf8');
      const problems = validateCss(text);
      if (problems.length) throw new Error(`doc.css rejected: ${problems.join('; ')}`);
      return text;
    }, (dir) => writeFile(join(dir, 'structure.html'), structure));
    if (css) {
      if (opts.cacheRoot) { await mkdir(opts.cacheRoot, { recursive: true }); await writeFile(join(opts.cacheRoot, `${hash}.css`), css); }
      req.onLog?.(`doc stylesheet written by the agent (style ${hash})`);
      return save(css, 'agent');
    }
  }
  req.onLog?.('doc stylesheet: using the fallback derived from the style tokens');
  return save(fallbackStylesheet(req.style), 'fallback');
}

/** Extra content in structure.html so the stylesheet agent sees a callout and a table even if the doc has none. */
const STRUCTURE_SAMPLE: DocSection = {
  id: 'structure-sample', title: 'Structure sample (not part of the doc)',
  body: 'A paragraph with **bold**, *emphasis*, `code` and a [link](#structure-sample).\n\n- A bullet\n- Another bullet\n\n### A subheading',
  figures: '> **Key point:** a callout is a blockquote.\n\n| Option | Cost | Replay |\n| --- | --- | --- |\n| Queue | Low | No |\n| Stream | Medium | Yes |',
};

// ---------- Figures: per section, from the visuals ----------

interface FigureEntry { hash: string; markdown: string; source: 'agent' | 'fallback' | 'none' }

const sceneHash = (s: TimedScene) => createHash('sha256').update(JSON.stringify([s.title, s.narration, s.visuals])).digest('hex').slice(0, 16);

/** Without the agent the section's visuals direction becomes a labelled callout, so nothing is lost. */
function fallbackFigure(s: TimedScene): string {
  const v = s.visuals.trim();
  return v ? `> **Figure:** ${v.replace(/\n+/g, '\n> ')}` : '';
}

async function ensureFigures(req: RenderRequest): Promise<Record<string, FigureEntry>> {
  const prev: Record<string, FigureEntry> = (req.cacheDir ? await readJson(join(req.cacheDir, 'figures.json')) : null) ?? {};
  const dirty = new Set(req.dirtyScenes ?? req.scenes.map((s) => s.id));
  const out: Record<string, FigureEntry> = {};
  const need: TimedScene[] = [];
  for (const s of req.scenes) {
    const hash = sceneHash(s);
    const p = prev[s.id];
    if (!s.visuals.trim()) out[s.id] = { hash, markdown: '', source: 'none' };
    else if (!dirty.has(s.id) && p?.hash === hash && p.source === 'agent') out[s.id] = p;
    else need.push(s);
  }
  if (need.length && req.agent) {
    const ids = need.map((s) => s.id);
    const got = await attempt(req, 'figures', (previousError) => ({
      kind: 'doc-figures',
      prompt: figuresPrompt(),
      inputs: {
        title: req.title, docRules: docRules(req.style), comments: req.comments ?? [],
        sections: need.map((s) => ({ id: s.id, title: s.title, body: s.narration, visuals: s.visuals })),
        ...(previousError ? { previousError } : {}),
      },
      resultFile: 'result.json',
      tools: FILE_TOOLS,
    }), async (_dir, output) => {
      const list = output?.sections;
      if (!Array.isArray(list)) throw new Error('result.json has no "sections" array');
      const byId = new Map<string, string>();
      for (const x of list) if (x && typeof x.id === 'string' && typeof x.markdown === 'string') byId.set(x.id, x.markdown.trim());
      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length) throw new Error(`result.json lacks sections ${missing.join(', ')}`);
      return byId;
    });
    for (const s of need) {
      if (got) out[s.id] = { hash: sceneHash(s), markdown: got.get(s.id)!, source: 'agent' };
    }
    if (got) req.onLog?.(`doc figures written for ${ids.join(', ')}`);
  }
  for (const s of need) {
    if (!out[s.id]) out[s.id] = { hash: sceneHash(s), markdown: fallbackFigure(s), source: 'fallback' };
  }
  if (need.some((s) => out[s.id].source === 'fallback')) req.onLog?.('doc figures: using the visuals as callouts for sections the agent could not do');
  await writeFile(join(req.workdir, 'figures.json'), JSON.stringify(out, null, 2));
  return out;
}
