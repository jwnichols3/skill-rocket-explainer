import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { App } from '../app.ts';
import { HttpError } from '../router.ts';
import { writeFileAtomic } from '../datadir.ts';
import { newId } from '../lock.ts';
import { VERSION } from '../version.ts';
import { validateDesign } from './design.ts';
import type { StyleReference, StyleView } from './store.ts';
import { IMAGE_TYPES, LIMITS, looksLikeImage } from '../pipeline/style-helpers.ts';
import { parseVoice, pickModel } from '../routes/styles.ts';

export const FORMAT = 'rocket-explainer-style';
export const FORMAT_VERSION = 1;

/** What travels: instructions, settings and references. Samples and round history stay behind. */
interface ExportedReference { kind: 'image' | 'video' | 'link'; name: string; note?: string; url?: string; ext?: string; data?: string; instructions?: string; analyzedAt?: string }
export interface StyleExport {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  style: { name: string | null; description: string; voice: unknown; model: string; effort: string; design: string; references: ExportedReference[] };
}

export const exportFileName = (name: string | null) =>
  `${(name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled-style'}.style.json`;

export async function exportStyle(app: App, id: string): Promise<StyleExport> {
  const s: StyleView = await app.styles.get(id);
  const references: ExportedReference[] = [];
  for (const r of s.references) {
    const common = { kind: r.kind, name: r.name, ...(r.note ? { note: r.note } : {}) };
    if (r.kind === 'link') references.push({ ...common, url: r.url });
    // Images travel as bytes; a video travels as what was learned from it (it can be hundreds of MB).
    else if (r.kind === 'image' && r.file) references.push({ ...common, ext: extname(r.file), data: (await readFile(join(app.styles.refsDir(id), r.file))).toString('base64') });
    else if (r.kind === 'video') references.push({ ...common, ...(r.instructions ? { instructions: r.instructions, analyzedAt: r.analyzedAt } : {}) });
  }
  return {
    format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date().toISOString(), appVersion: VERSION,
    style: { name: s.name, description: s.description, voice: s.voice, model: s.model, effort: s.effort, design: s.design, references },
  };
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Checks everything before writing anything, so a bad file creates no style. */
export async function importStyle(app: App, text: string): Promise<StyleView> {
  let doc: any;
  try { doc = JSON.parse(text); } catch {}
  if (doc?.format !== FORMAT || typeof doc.style !== 'object' || !doc.style) throw new HttpError(400, 'this is not a style export (a .style.json file from Export)');
  if (!(doc.version <= FORMAT_VERSION)) throw new HttpError(400, `this style was exported by a newer version of Rocket Explainer (format ${doc.version}); update to import it`);
  const st = doc.style;

  const description = str(st.description);
  if (!description) throw new HttpError(400, 'the export has no description');
  if (typeof st.design !== 'string') throw new HttpError(400, 'the export has no design (DESIGN.md)');
  const problems = validateDesign(st.design);
  if (problems.length) throw new HttpError(400, `the export's design (DESIGN.md) is not valid: ${problems.join('; ')}`);
  const voice = parseVoice(app, st.voice);
  const { model, effort } = pickModel(app, st);

  const now = new Date().toISOString();
  const refs: { ref: StyleReference; bytes?: Buffer }[] = [];
  for (const r of Array.isArray(st.references) ? st.references : []) {
    const id = newId('ref_');
    const name = str(r?.name) ?? 'reference';
    const note = str(r?.note);
    const common = { id, name, ...(note ? { note } : {}), createdAt: now };
    if (r?.kind === 'link') {
      let u: URL | undefined;
      try { u = new URL(r.url); } catch {}
      if (u?.protocol !== 'http:' && u?.protocol !== 'https:') throw new HttpError(400, `reference "${name}": url must be an absolute http(s) URL`);
      refs.push({ ref: { ...common, kind: 'link', url: u.href } });
    } else if (r?.kind === 'image') {
      const ext = r.ext === '.jpeg' ? '.jpg' : r.ext;
      if (!Object.values(IMAGE_TYPES).includes(ext) || typeof r.data !== 'string') throw new HttpError(400, `reference "${name}": not a png, jpg, webp or gif image`);
      const bytes = Buffer.from(r.data, 'base64');
      if (bytes.length > LIMITS.image) throw new HttpError(413, `reference "${name}": images are limited to ${LIMITS.image / 1e6} MB`);
      if (!looksLikeImage(bytes.subarray(0, 12), ext)) throw new HttpError(415, `reference "${name}": the file is not a ${ext.slice(1)} image`);
      refs.push({ ref: { ...common, kind: 'image', file: `${id}${ext}` }, bytes });
    } else if (r?.kind === 'video') {
      const instructions = str(r.instructions);
      refs.push({ ref: { ...common, kind: 'video', ...(instructions ? { instructions, analyzedAt: str(r.analyzedAt) ?? now } : {}) } });
    }
  }

  const taken = new Set((await app.styles.list()).map((s) => s.name));
  let name = str(st.name) ?? null;
  if (name && taken.has(name)) {
    const base = name;
    name = `${base} (imported)`;
    for (let i = 2; taken.has(name); i++) name = `${base} (imported ${i})`;
  }

  const meta = await app.styles.create({ name, description, voice, model, effort, design: st.design });
  for (const { ref, bytes } of refs) if (bytes) await writeFileAtomic(join(app.styles.refsDir(meta.id), ref.file!), bytes);
  if (refs.length) await app.styles.update(meta.id, (m) => { m.references = refs.map((x) => x.ref); });
  return app.styles.get(meta.id);
}
