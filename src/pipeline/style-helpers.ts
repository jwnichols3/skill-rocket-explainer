import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, cp, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import type { App } from '../app.ts';
import type { JobCtx } from '../jobs.ts';
import { HttpError } from '../router.ts';
import { writeFileAtomic } from '../datadir.ts';
import { newId } from '../lock.ts';
import { exec, probeDurationMs, probeStreams } from '../media.ts';
import { validateDesign } from '../style/design.ts';
import type { StyleReference } from '../style/store.ts';
import { referenceVideoPrompt, styleSuggestionsPrompt, SUGGESTION_TOPICS } from '../prompts/style.ts';
import { expandHome } from './explainer-prep.ts';

// ---------- Reference files ----------

/** Accepted reference media: content type -> stored extension. */
export const IMAGE_TYPES: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
export const VIDEO_TYPES: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'video/x-m4v': '.m4v' };
export const LIMITS = { image: 20_000_000, video: 500_000_000 };

const EXT_KIND: Record<string, 'image' | 'video'> = Object.fromEntries([
  ...Object.values(IMAGE_TYPES).map((e) => [e, 'image']), ['.jpeg', 'image'],
  ...Object.values(VIDEO_TYPES).map((e) => [e, 'video']),
]);

/** The first bytes must match the declared image type, so junk can't be stored as a .png. */
function looksLikeImage(head: Buffer, ext: string): boolean {
  if (ext === '.png') return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (ext === '.gif') return head.subarray(0, 4).toString('latin1') === 'GIF8';
  if (ext === '.webp') return head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

async function checkMedia(file: string, kind: 'image' | 'video', ext: string): Promise<void> {
  if (kind === 'image') {
    const fh = await open(file);
    const head = Buffer.alloc(12);
    try { await fh.read(head, 0, 12, 0); } finally { await fh.close(); }
    if (!looksLikeImage(head, ext)) throw new HttpError(415, `the file is not a ${ext.slice(1)} image`);
    return;
  }
  const streams: string[] = await probeStreams(file).catch(() => []);
  if (!streams.includes('video')) throw new HttpError(415, 'the file has no readable video stream');
}

const cleanName = (s: string) => basename(s).replace(/[^\w .()-]/g, '_').slice(0, 120) || 'reference';

/** Stores a reference file (already written to `tmp` inside refsDir) and records it. */
async function keepFile(app: App, styleId: string, tmp: string, kind: 'image' | 'video', ext: string, name: string): Promise<StyleReference> {
  try { await checkMedia(tmp, kind, ext); } catch (err) { await rm(tmp, { force: true }); throw err; }
  const id = newId('ref_');
  const file = `${id}${ext}`;
  await rename(tmp, join(app.styles.refsDir(styleId), file));
  return app.styles.addReference(styleId, { id, kind, name: cleanName(name), file, createdAt: new Date().toISOString() });
}

/**
 * Raw upload: the request body is the file. The browser may be on another machine
 * (reverse proxy), so it can't hand us a path; it sends the bytes.
 */
export async function referenceFromUpload(app: App, styleId: string, req: IncomingMessage, name: string): Promise<StyleReference> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const kind = IMAGE_TYPES[type] ? 'image' : VIDEO_TYPES[type] ? 'video' : null;
  if (!kind) throw new HttpError(415, `unsupported type "${type}": images (${Object.keys(IMAGE_TYPES).join(', ')}) or videos (${Object.keys(VIDEO_TYPES).join(', ')})`);
  const limit = LIMITS[kind];
  if (Number(req.headers['content-length'] ?? 0) > limit) throw new HttpError(413, `${kind} uploads are limited to ${limit / 1e6} MB`);
  const dir = app.styles.refsDir(styleId);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `upload-${crypto.randomUUID().slice(0, 8)}.tmp`);
  let size = 0;
  try {
    await pipeline(req, async function* (src) {
      for await (const chunk of src) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, `${kind} uploads are limited to ${limit / 1e6} MB`);
        yield chunk;
      }
    }, createWriteStream(tmp));
  } catch (err) { await rm(tmp, { force: true }); throw err; }
  if (!size) { await rm(tmp, { force: true }); throw new HttpError(400, 'empty upload'); }
  const ext = (kind === 'image' ? IMAGE_TYPES : VIDEO_TYPES)[type];
  return keepFile(app, styleId, tmp, kind, ext, name || `reference${ext}`);
}

/** A local file path (same machine as the app): copied in, so the style stays self-contained. */
export async function referenceFromPath(app: App, styleId: string, path: string): Promise<StyleReference> {
  const full = resolve(expandHome(path));
  const ext = extname(full).toLowerCase();
  const kind = EXT_KIND[ext];
  if (!kind) throw new HttpError(415, `unsupported file type "${ext}": images (.png, .jpg, .webp, .gif) or videos (.mp4, .mov, .webm, .mkv, .m4v)`);
  const st = await stat(full).catch(() => null);
  if (!st?.isFile()) throw new HttpError(400, `no such file: ${path}`);
  if (st.size > LIMITS[kind]) throw new HttpError(413, `${kind} references are limited to ${LIMITS[kind] / 1e6} MB`);
  const dir = app.styles.refsDir(styleId);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `copy-${crypto.randomUUID().slice(0, 8)}.tmp`);
  await pipeline(createReadStream(full), createWriteStream(tmp));
  return keepFile(app, styleId, tmp, kind, ext === '.jpeg' ? '.jpg' : ext, basename(full));
}

export function referenceLink(app: App, styleId: string, url: string, note?: string): Promise<StyleReference> {
  let u: URL;
  try { u = new URL(url); } catch { throw new HttpError(400, 'url must be an absolute http(s) URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'url must be an absolute http(s) URL');
  const n = note?.trim();
  return app.styles.addReference(styleId, { id: newId('ref_'), kind: 'link', name: u.href, url: u.href, ...(n ? { note: n } : {}), createdAt: new Date().toISOString() });
}

/**
 * The sample task's view of a style's references. Images are copied into the agent's
 * workdir so a confined agent can Read them by relative path.
 */
export async function referenceInputs(app: App, styleId: string, refs: StyleReference[], workdir: string) {
  const out: Record<string, unknown>[] = [];
  for (const r of refs) {
    if (r.kind === 'image' && r.file) {
      await mkdir(join(workdir, 'references'), { recursive: true });
      await copyFile(join(app.styles.refsDir(styleId), r.file), join(workdir, 'references', r.file));
      out.push({ kind: 'image', name: r.name, file: `references/${r.file}` });
    } else if (r.kind === 'link') {
      out.push({ kind: 'link', url: r.url, ...(r.note ? { note: r.note } : {}) });
    } else if (r.kind === 'video') {
      out.push({ kind: 'video', name: r.name, ...(r.instructions ? { instructions: r.instructions } : {}) });
    }
  }
  return out;
}

// ---------- Frame sampling ----------

export interface SampleOptions {
  maxFrames?: number; maxWidth?: number; sceneThreshold?: number; maxSeconds?: number;
  /** Seconds between interval frames; defaults to spreading maxFrames over the clip. */
  intervalS?: number;
  signal?: AbortSignal;
}

/**
 * Stills for a vision model: a frame at every scene change (ffmpeg scene score), plus one at a
 * regular interval so long static shots are covered, never two within 1 s (the ~1 fps cap).
 * Downscaled JPEGs. If that yields more than maxFrames, an even subset is kept.
 */
export async function sampleFrames(video: string, outDir: string, opts: SampleOptions = {}): Promise<{ file: string; atMs: number }[]> {
  const { maxFrames = 24, maxWidth = 768, sceneThreshold = 0.3, maxSeconds = 600 } = opts;
  const seconds = Math.min(maxSeconds, (await probeDurationMs(video)) / 1000);
  const every = Math.max(1, opts.intervalS ?? seconds / maxFrames).toFixed(2);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const select = `select='isnan(prev_selected_t)+gte(t-prev_selected_t,1)*(gt(scene,${sceneThreshold})+gte(t-prev_selected_t,${every}))'`;
  const args = ['-hide_banner', '-nostats', '-loglevel', 'info', '-t', String(maxSeconds), '-i', video, '-an', '-sn',
    '-vf', `${select},showinfo,scale='min(${maxWidth},iw)':-2`, '-fps_mode', 'vfr', '-q:v', '4', join(outDir, 'f%03d.jpg')];
  const r = await exec('ffmpeg', args, { signal: opts.signal });
  if (r.code !== 0) throw new Error(`frame sampling failed: ${r.stderr.trim().split('\n').slice(-5).join(' ')}`);
  const times = [...r.stderr.matchAll(/Parsed_showinfo.*?pts_time:\s*([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 1000));
  const files = (await readdir(outDir)).filter((f) => /^f\d+\.jpg$/.test(f)).sort();
  if (!files.length) throw new Error('no frames could be sampled from the video');
  let frames = files.map((file, i) => ({ file, atMs: times[i] ?? 0 }));
  if (frames.length > maxFrames) {
    const keep = new Set(Array.from({ length: maxFrames }, (_, i) => Math.round((i * (frames.length - 1)) / (maxFrames - 1))));
    for (const [i, f] of frames.entries()) if (!keep.has(i)) await rm(join(outDir, f.file));
    frames = frames.filter((_, i) => keep.has(i));
  }
  return frames;
}

// ---------- Reference video -> style instructions (background job) ----------

export async function runReferenceVideo(app: App, styleId: string, refId: string, ctx: JobCtx) {
  const store = app.styles;
  const meta = await store.meta(styleId);
  const ref = meta.references?.find((r) => r.id === refId);
  if (!ref || ref.kind !== 'video' || !ref.file) throw new Error(`no reference video ${refId}`);
  const src = join(store.refsDir(styleId), ref.file);
  const workdir = join(app.paths.home, 'work', ctx.id, 'agent');

  ctx.stage('Sampling frames', 0.05, ref.name);
  const durationMs = await probeDurationMs(src);
  const frames = await sampleFrames(src, join(workdir, 'frames'), { signal: ctx.signal });
  ctx.log(`sampled ${frames.length} frames at ${frames.map((f) => (f.atMs / 1000).toFixed(1) + 's').join(', ')}`);
  const keep = join(store.refsDir(styleId), `${refId}-frames`);
  await rm(keep, { recursive: true, force: true });
  await cp(join(workdir, 'frames'), keep, { recursive: true });

  ctx.stage('Reading the frames', 0.25, `${frames.length} frames · ${meta.model} · ${meta.effort}`);
  const res = await app.providers.agent().run({
    kind: 'style-reference-video',
    prompt: referenceVideoPrompt(),
    inputs: {
      description: meta.description,
      currentDesign: await store.design(styleId),
      video: { name: ref.name, durationMs },
      frames: frames.map((f) => ({ file: `frames/${f.file}`, atMs: f.atMs })),
    },
    resultFile: 'result.json',
    tools: ['Read', 'Write'],
  }, { workdir, model: meta.model, effort: meta.effort, signal: ctx.signal, onLog: ctx.log });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  const instructions = typeof res.output?.instructions === 'string' ? res.output.instructions.trim() : '';
  if (!instructions) throw new Error('the agent returned no style instructions');
  const design = typeof res.output?.design === 'string' ? res.output.design : '';
  const problems = design ? validateDesign(design) : ['design is missing'];
  if (problems.length) ctx.log(`DESIGN.md draft not applied: ${problems.join('; ')}`);

  ctx.stage('Saving instructions', 0.95);
  await store.update(styleId, async (m) => {
    m.description = `${m.description}\n\nFrom the reference video "${ref.name}":\n${instructions}`;
    const r = m.references?.find((x) => x.id === refId);
    if (r) Object.assign(r, { frames, instructions, analyzedAt: new Date().toISOString() });
    if (!problems.length) await writeFileAtomic(join(store.dir(styleId), 'DESIGN.md'), design);
  });
  return { frames: frames.length, designUpdated: !problems.length };
}

// ---------- Instruction suggestions (quick, synchronous) ----------

export async function suggestImprovements(app: App, description: string, model: string): Promise<{ topic: string; text: string }[]> {
  const res = await app.providers.agent().run({
    kind: 'style-suggestions', prompt: styleSuggestionsPrompt(), inputs: { description }, resultFile: 'result.json', tools: ['Read', 'Write'],
  }, { workdir: join(app.paths.home, 'work', `suggest-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`), model, effort: 'low' });
  if (!res.ok) throw new HttpError(502, `suggestions failed: ${res.error.message}`);
  const list = (Array.isArray(res.output?.suggestions) ? res.output.suggestions : [])
    .filter((s: any) => s && typeof s.text === 'string' && s.text.trim())
    .map((s: any) => ({ topic: (SUGGESTION_TOPICS as readonly string[]).includes(s.topic) ? s.topic : 'other', text: s.text.trim() }))
    .slice(0, 6);
  if (list.length < 3) throw new HttpError(502, 'the agent returned too few suggestions');
  return list;
}
