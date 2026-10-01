import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Renderer, RenderRequest, RenderResult, TimedScene } from '../types.ts';
import { parseDesign } from '../../style/design.ts';
import { withBrowser } from '../../browser.ts';
import { SLIDE_W, SLIDE_H, tokensFrom, parseSlideModel, fallbackModel, type Tokens, type SlideModel, type Box } from './model.ts';
import { assembleDeck, checkSlideHtml } from './html.ts';
import { writePptx } from './pptx.ts';
import { slidePrompt, slideFiles } from './prompt.ts';

const SLIDE_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
/** Agent failures a retry can't fix. */
const FATAL = new Set(['cancelled', 'auth', 'unavailable', 'timeout']);

const exists = (f: string) => access(f).then(() => true, () => false);

/** Scene ids double as file names; keep them simple. */
export const slideBase = (sceneId: string) => sceneId.replace(/[^A-Za-z0-9_-]/g, '-');

/**
 * Deck renderer: per dirty slide an agent writes slides/<id>.html (the 1920x1080 slide, for
 * fidelity) and slides/<id>.json (a structured model, for an editable .pptx). Headless Chromium
 * checks the HTML (no text cut off at the edges) and captures any "snapshot" regions the model
 * can't express natively. Clean slides are reused from cacheDir. Outputs deck.html (primary) and deck.pptx.
 */
export function createDeckRenderer(): Renderer {
  return {
    id: 'html-deck',
    label: 'HTML slides + editable PowerPoint',
    outputTypes: ['deck'],
    async render(req: RenderRequest): Promise<RenderResult> {
      if (req.outputType !== 'deck') throw new Error(`the deck renderer renders decks, not ${req.outputType}`);
      const seen = new Map<string, string>();
      for (const s of req.scenes) {
        const prev = seen.get(slideBase(s.id));
        if (prev !== undefined) throw new Error(`slide ids "${prev}" and "${s.id}" map to the same file name`);
        seen.set(slideBase(s.id), s.id);
      }
      let tokens: Tokens = { colors: {}, fonts: {} };
      try { tokens = tokensFrom(parseDesign(req.style).tokens); } catch { /* the agent still gets the full DESIGN.md */ }
      const slidesDir = join(req.workdir, 'slides');
      await mkdir(slidesDir, { recursive: true });

      const rendered: string[] = [];
      for (const [i, scene] of req.scenes.entries()) {
        const base = slideBase(scene.id);
        const cached = req.cacheDir ? join(req.cacheDir, 'slides') : '';
        const dirty = !req.dirtyScenes || req.dirtyScenes.includes(scene.id);
        if (!dirty && cached && await exists(join(cached, `${base}.html`)) && await exists(join(cached, `${base}.json`))) {
          for (const f of await slideFilesIn(cached, base)) await copyFile(join(cached, f), join(slidesDir, f));
          req.onLog?.(`reused slide ${scene.id} from cache`);
          continue;
        }
        if (req.signal?.aborted) throw new Error('cancelled');
        req.onScene?.(scene.id, i, req.scenes.length);
        await writeSlide(req, scene, i, tokens);
        rendered.push(scene.id);
      }

      const deckSlides = [];
      for (const scene of req.scenes) {
        const base = slideBase(scene.id);
        const html = await readFile(join(slidesDir, `${base}.html`), 'utf8');
        const parsed = parseSlideModel(JSON.parse(await readFile(join(slidesDir, `${base}.json`), 'utf8')), tokens);
        const model = parsed.model ?? fallbackModel(tokens.colors.background ?? 'FFFFFF');
        const snaps = model.elements.filter((e) => e.type === 'snapshot').map((_, n) => join(slidesDir, `${base}.snap-${n}.png`));
        deckSlides.push({ scene, html, model, snapshots: snaps });
      }
      const html = join(req.workdir, 'deck.html');
      await writeFile(html, assembleDeck(req.title, tokens.colors.background ?? '000000', deckSlides.map((s) => ({ id: s.scene.id, title: s.scene.title, html: s.html }))));
      const pptx = join(req.workdir, 'deck.pptx');
      await writePptx(pptx, { title: req.title, slides: deckSlides.map((s) => ({ model: s.model, snapshots: s.snapshots, notes: s.scene.narration })) });
      const pictures = deckSlides.filter((s) => s.model.fallback).map((s) => s.scene.id);
      if (pictures.length) req.onLog?.(`deck.pptx: slide${pictures.length === 1 ? '' : 's'} ${pictures.join(', ')} ${pictures.length === 1 ? 'is a picture' : 'are pictures'} (no valid slide model); the rest are editable`);
      return { primary: html, files: [html, pptx], sceneCount: req.scenes.length, rendered };
    },
  };
}

async function slideFilesIn(dir: string, base: string): Promise<string[]> {
  return (await readdir(dir)).filter((f) => f.startsWith(`${base}.`));
}

/** One slide: the agent writes HTML + model; we check both; one retry with the problems fed back. */
async function writeSlide(req: RenderRequest, scene: TimedScene, index: number, tokens: Tokens): Promise<void> {
  const agent = req.agent;
  if (!agent) throw new Error('the deck renderer needs an agent to write slides');
  const base = slideBase(scene.id);
  const files = slideFiles(base);
  const slidesDir = join(req.workdir, 'slides');
  let previousError: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const dir = join(req.workdir, 'tasks', base, `attempt-${attempt}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'DESIGN.md'), req.style);
    // previous/: the failed attempt on a retry, else the previous render of this slide.
    const prevDir = attempt > 1 ? join(req.workdir, 'tasks', base, `attempt-${attempt - 1}`, 'slides') : req.cacheDir ? join(req.cacheDir, 'slides') : '';
    for (const ext of ['html', 'json']) {
      const f = join(prevDir, `${base}.${ext}`);
      if (prevDir && await exists(f)) { await mkdir(join(dir, 'previous'), { recursive: true }); await copyFile(f, join(dir, 'previous', `${base}.${ext}`)); }
    }
    // reference/: the nearest earlier slide already in this deck, for consistent chrome.
    const ref = await nearestEarlier(req, index);
    if (ref) { await mkdir(join(dir, 'reference'), { recursive: true }); await copyFile(ref, join(dir, 'reference', 'slide.html')); }

    req.onLog?.(`writing slide ${scene.id} (attempt ${attempt})`);
    const res = await agent.surface.run({
      kind: 'deck-slide',
      prompt: slidePrompt(files),
      inputs: {
        deckTitle: req.title, index, total: req.scenes.length,
        outline: req.scenes.map((s) => ({ id: s.id, title: s.title })),
        slide: { id: scene.id, title: scene.title, body: scene.narration, visuals: scene.visuals },
        width: SLIDE_W, height: SLIDE_H, files, style: req.style,
        comments: req.comments ?? [],
        ...(previousError ? { previousError } : {}),
      },
      expectFiles: [files.html, files.json],
      tools: SLIDE_TOOLS,
    }, { workdir: dir, model: agent.model, effort: agent.effort, signal: req.signal, onLog: req.onLog });

    const problems: string[] = [];
    let model: SlideModel | null = null;
    let htmlOk = false;
    if (!res.ok) {
      if (FATAL.has(res.error.kind) || req.signal?.aborted) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
      problems.push(res.error.message);
    } else {
      const htmlFile = join(dir, files.html);
      const html = await readFile(htmlFile, 'utf8').catch(() => '');
      problems.push(...checkSlideHtml(html));
      htmlOk = !problems.length;
      try {
        const parsed = parseSlideModel(JSON.parse(await readFile(join(dir, files.json), 'utf8')), tokens);
        if (parsed.model) model = parsed.model; else problems.push(...parsed.problems.map((p) => `${files.json}: ${p}`));
      } catch (err: any) {
        problems.push(`${files.json} is not valid JSON: ${err.message}`);
      }
      if (htmlOk) {
        const lastTry = attempt === 2;
        // A model still invalid after the retry: the PowerPoint slide becomes a picture of the HTML.
        const fellBack = !model && lastTry;
        const use = model ?? (fellBack ? fallbackModel(tokens.colors.background ?? 'FFFFFF') : null);
        const shots = (use?.elements ?? []).filter((e) => e.type === 'snapshot').map((e, n) => ({ box: e as Box, out: join(dir, 'slides', `${base}.snap-${n}.png`) }));
        const cut = await inspectSlide(htmlFile, shots);
        if (cut.length && !lastTry) problems.push(`text is cut off at the slide edges (the slide is ${SLIDE_W}x${SLIDE_H}): ${cut.join('; ')}`);
        else if (use) {
          if (cut.length) req.onLog?.(`slide ${scene.id}: text still cut off after a retry, keeping it: ${cut.join('; ')}`);
          if (fellBack) req.onLog?.(`slide ${scene.id}: no valid slide model after a retry (${problems.join('; ')}); its PowerPoint slide is a picture`);
          // Keep the resolved model (hex colours, font families), so a reused slide doesn't depend on later token changes.
          await writeFile(join(dir, files.json), JSON.stringify(use, null, 2));
          for (const f of await slideFilesIn(join(dir, 'slides'), base)) await copyFile(join(dir, 'slides', f), join(slidesDir, f));
          return;
        }
      }
    }
    previousError = problems.join('\n');
    req.onLog?.(`slide ${scene.id} attempt ${attempt} failed: ${problems[0]}`);
    if (attempt === 2) throw new Error(`could not render slide "${scene.id}" (${scene.title}) after a retry: ${previousError}`);
  }
}

async function nearestEarlier(req: RenderRequest, index: number): Promise<string | null> {
  for (let i = index - 1; i >= 0; i--) {
    const f = join(req.workdir, 'slides', `${slideBase(req.scenes[i].id)}.html`);
    if (await exists(f)) return f;
  }
  return null;
}

/**
 * Loads the slide at 1920x1080 with the network blocked, reports text that runs past the slide
 * edges, and captures the given regions as PNGs.
 */
async function inspectSlide(htmlFile: string, shots: { box: Box; out: string }[]): Promise<string[]> {
  return withBrowser(async (b) => {
    const page = await b.newPage({ viewport: { width: SLIDE_W, height: SLIDE_H } });
    await page.route(/^https?:/, (r) => r.abort());
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    const cut = await page.evaluate(([W, H]) => {
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n = walker.nextNode(); n && out.length < 5; n = walker.nextNode()) {
        const text = (n.textContent ?? '').trim();
        const el = n.parentElement;
        if (!text || !el || el.closest('style, title, script')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        range.selectNodeContents(n);
        const r = range.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2) out.push(`"${text.slice(0, 40)}" spans x ${Math.round(r.left)}-${Math.round(r.right)}, y ${Math.round(r.top)}-${Math.round(r.bottom)}`);
      }
      return out;
    }, [SLIDE_W, SLIDE_H]);
    for (const s of shots) {
      const x = Math.max(0, s.box.x), y = Math.max(0, s.box.y);
      const w = Math.min(SLIDE_W, s.box.x + s.box.w) - x, h = Math.min(SLIDE_H, s.box.y + s.box.h) - y;
      if (w < 1 || h < 1) continue;
      await mkdir(join(s.out, '..'), { recursive: true });
      await page.screenshot({ path: s.out, clip: { x, y, width: w, height: h } });
    }
    return cut;
  });
}
