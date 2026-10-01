import { readFile, readdir, mkdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from '../datadir.ts';
import { readJson, writeJson, writeFileAtomic } from '../datadir.ts';
import { KeyedLock, newId } from '../lock.ts';
import { designTemplate, palette } from './design.ts';
import type { ScenePlan, VoiceControls, AgentUsage } from '../providers/types.ts';
import type { OutputType } from '../settings.ts';

export interface VoiceChoice { provider: string; voiceId: string; controls: VoiceControls }

export interface StyleComment { id: string; text: string; atMs?: number; createdAt: string }

export interface Round {
  n: number;
  createdAt: string;
  model: string;
  effort: string;
  voice: VoiceChoice;
  /** What the agent says changed this round. */
  summary: string;
  scenes: (ScenePlan & { startMs?: number; durationMs?: number })[];
  durationMs?: number;
  /** Comments left on this round's sample; they feed the next round. */
  comments: StyleComment[];
  /** The round these instructions were derived from. */
  basedOn: number | null;
  /** Sample type; absent means video. */
  outputType?: OutputType;
  /** Sample files in the round dir, primary first; absent means ['sample.mp4']. */
  files?: string[];
  usage?: AgentUsage;
}

export interface StyleMeta {
  id: string;
  name: string | null;
  description: string;
  voice: VoiceChoice;
  model: string;
  effort: string;
  currentRound: number | null;
  createdAt: string;
  updatedAt: string;
  /** Set when the style was explicitly saved (named). */
  savedAt: string | null;
  clonedFrom?: string;
  /** Reference images, videos and links that inform the style. Files live in references/. */
  references?: StyleReference[];
}

export interface StyleReference {
  id: string;
  kind: 'image' | 'video' | 'link';
  /** Display name: the original file name, or the link. */
  name: string;
  /** File name under references/ (image, video). */
  file?: string;
  url?: string;
  note?: string;
  /** Video: frames sampled for analysis, under references/<id>-frames/. */
  frames?: { file: string; atMs: number }[];
  /** Video: the style instructions the model derived from the frames. */
  instructions?: string;
  analyzedAt?: string;
  createdAt: string;
}

export interface StyleView extends StyleMeta {
  design: string;
  palette: [string, string][];
  rounds: (Round & { outputType: OutputType; designUrl: string; url: string; sampleUrl: string; fileUrls: string[] })[];
  references: (StyleReference & { fileUrl?: string; frameUrls?: string[] })[];
}

export class StyleStore {
  private lock = new KeyedLock();
  private p: Paths;
  constructor(p: Paths) { this.p = p; }

  dir(id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('bad style id');
    return join(this.p.styles, id);
  }
  roundDir(id: string, n: number) { return join(this.dir(id), 'rounds', String(n)); }
  refsDir(id: string) { return join(this.dir(id), 'references'); }

  async exists(id: string): Promise<boolean> {
    return (await readJson<StyleMeta | null>(join(this.dir(id), 'style.json'), null)) !== null;
  }

  async meta(id: string): Promise<StyleMeta> {
    const m = await readJson<StyleMeta | null>(join(this.dir(id), 'style.json'), null);
    if (!m) throw Object.assign(new Error(`no style ${id}`), { status: 404 });
    return m;
  }

  async design(id: string): Promise<string> {
    return readFile(join(this.dir(id), 'DESIGN.md'), 'utf8');
  }

  async rounds(id: string): Promise<Round[]> {
    let names: string[] = [];
    try { names = await readdir(join(this.dir(id), 'rounds')); } catch {}
    const rounds: Round[] = [];
    for (const n of names.map(Number).filter((n) => n > 0).sort((a, b) => a - b)) {
      const r = await readJson<Round | null>(join(this.roundDir(id, n), 'round.json'), null);
      if (r) rounds.push(r);
    }
    return rounds;
  }

  async get(id: string): Promise<StyleView> {
    const m = await this.meta(id);
    const design = await this.design(id);
    const rounds = (await this.rounds(id)).map((r) => {
      const base = `/media/styles/${id}/rounds/${r.n}`;
      const files = r.files ?? ['sample.mp4'];
      return { ...r, outputType: r.outputType ?? 'video', designUrl: `${base}/DESIGN.md`, url: `${base}/${files[0]}`, sampleUrl: `${base}/${files[0]}`, fileUrls: files.map((f) => `${base}/${f}`) };
    });
    const media = `/media/styles/${id}/references`;
    const references = (m.references ?? []).map((r) => ({
      ...r,
      ...(r.file ? { fileUrl: `${media}/${r.file}` } : {}),
      ...(r.frames ? { frameUrls: r.frames.map((f) => `${media}/${r.id}-frames/${f.file}`) } : {}),
    }));
    return { ...m, design, palette: palette(design), rounds, references };
  }

  async list(): Promise<(StyleMeta & { palette: [string, string][]; sampleUrl: string | null; rounds: number })[]> {
    let ids: string[] = [];
    try { ids = await readdir(this.p.styles); } catch {}
    const out = [];
    for (const id of ids) {
      const m = await readJson<StyleMeta | null>(join(this.p.styles, id, 'style.json'), null);
      if (!m) continue;
      const design = await this.design(id).catch(() => '');
      const all = await this.rounds(id);
      const video = all.filter((r) => !r.outputType || r.outputType === 'video').at(-1);
      out.push({ ...m, palette: palette(design), rounds: all.length, sampleUrl: video ? `/media/styles/${id}/rounds/${video.n}/sample.mp4` : null });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: { name?: string | null; description: string; voice: VoiceChoice; model: string; effort: string; design?: string }): Promise<StyleMeta> {
    const id = newId('st_');
    const now = new Date().toISOString();
    const name = input.name?.trim() || null;
    const meta: StyleMeta = {
      id, name, description: input.description, voice: input.voice, model: input.model, effort: input.effort,
      currentRound: null, createdAt: now, updatedAt: now, savedAt: name ? now : null,
    };
    await mkdir(join(this.dir(id), 'rounds'), { recursive: true });
    await writeFileAtomic(join(this.dir(id), 'DESIGN.md'), input.design ?? designTemplate(input.description));
    await writeJson(join(this.dir(id), 'style.json'), meta);
    return meta;
  }

  update(id: string, fn: (m: StyleMeta) => void | Promise<void>): Promise<StyleMeta> {
    return this.lock.run(id, async () => {
      const m = await this.meta(id);
      await fn(m);
      m.updatedAt = new Date().toISOString();
      await writeJson(join(this.dir(id), 'style.json'), m);
      return m;
    });
  }

  updateRound(id: string, n: number, fn: (r: Round) => void): Promise<Round> {
    return this.lock.run(id, async () => {
      const file = join(this.roundDir(id, n), 'round.json');
      const r = await readJson<Round | null>(file, null);
      if (!r) throw Object.assign(new Error(`no round ${n}`), { status: 404 });
      fn(r);
      await writeJson(file, r);
      return r;
    });
  }

  /** Records a finished round and makes it current. The sample file must already be in the round dir. */
  async addRound(id: string, round: Omit<Round, 'n' | 'createdAt' | 'comments'>, design: string, stageDir: string): Promise<Round> {
    return this.lock.run(id, async () => {
      const m = await this.meta(id);
      const n = ((await this.rounds(id)).at(-1)?.n ?? 0) + 1;
      const dir = this.roundDir(id, n);
      await mkdir(dir, { recursive: true });
      await cp(stageDir, dir, { recursive: true });
      await writeFileAtomic(join(dir, 'DESIGN.md'), design);
      const full: Round = { ...round, n, createdAt: new Date().toISOString(), comments: [] };
      await writeJson(join(dir, 'round.json'), full);
      await writeFileAtomic(join(this.dir(id), 'DESIGN.md'), design);
      m.currentRound = n;
      m.updatedAt = full.createdAt;
      await writeJson(join(this.dir(id), 'style.json'), m);
      return full;
    });
  }

  /** Records a reference; its file (if any) must already be in refsDir. */
  async addReference(id: string, ref: StyleReference): Promise<StyleReference> {
    await this.update(id, (m) => { m.references = [...(m.references ?? []), ref]; });
    return ref;
  }

  async removeReference(id: string, refId: string): Promise<void> {
    let gone: StyleReference | undefined;
    await this.update(id, (m) => {
      gone = m.references?.find((r) => r.id === refId);
      if (!gone) throw Object.assign(new Error(`no reference ${refId}`), { status: 404 });
      m.references = m.references!.filter((r) => r.id !== refId);
    });
    if (gone?.file) await rm(join(this.refsDir(id), gone.file), { force: true });
    await rm(join(this.refsDir(id), `${refId}-frames`), { recursive: true, force: true });
  }

  async addComment(id: string, n: number, text: string, atMs?: number): Promise<StyleComment> {
    const comment: StyleComment = { id: newId('c_'), text, ...(atMs !== undefined ? { atMs } : {}), createdAt: new Date().toISOString() };
    await this.updateRound(id, n, (r) => { r.comments.push(comment); });
    await this.update(id, () => {});
    return comment;
  }

  async removeComment(id: string, n: number, commentId: string): Promise<void> {
    await this.updateRound(id, n, (r) => { r.comments = r.comments.filter((c) => c.id !== commentId); });
  }

  /** Makes an earlier round current (its instructions become the style's). Later rounds are kept. */
  async revert(id: string, n: number): Promise<StyleMeta> {
    const design = await readFile(join(this.roundDir(id, n), 'DESIGN.md'), 'utf8').catch(() => null);
    if (design === null) throw Object.assign(new Error(`no round ${n}`), { status: 404 });
    return this.update(id, async (m) => {
      await writeFileAtomic(join(this.dir(id), 'DESIGN.md'), design);
      m.currentRound = n;
    });
  }

  /** An independent copy: instructions, settings and round history. */
  async clone(id: string, name?: string | null): Promise<StyleMeta> {
    const src = await this.meta(id);
    const copyId = newId('st_');
    await cp(this.dir(id), this.dir(copyId), { recursive: true });
    const now = new Date().toISOString();
    const meta: StyleMeta = {
      ...src, id: copyId, name: name?.trim() || (src.name ? `${src.name} copy` : null),
      createdAt: now, updatedAt: now, savedAt: null, clonedFrom: id,
    };
    await writeJson(join(this.dir(copyId), 'style.json'), meta);
    return meta;
  }

  async delete(id: string): Promise<void> {
    await this.meta(id);
    await rm(this.dir(id), { recursive: true, force: true });
  }
}
