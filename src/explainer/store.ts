import { readdir, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from '../datadir.ts';
import { readJson, writeJson } from '../datadir.ts';
import { KeyedLock, newId } from '../lock.ts';
import type { OutputType } from '../settings.ts';

export type SourceKind = 'path' | 'url' | 'connector' | 'note';

export interface Source { id: string; kind: SourceKind; value: string; label?: string; enabled: boolean }

export interface SourceFinding {
  sourceId: string;
  found: boolean;
  /** What the source is, one or two sentences. */
  summary: string;
  /** What the agent extracted (key points, quotes) - the drill-in view. */
  extract: string;
  /** Why it wasn't found, or caveats. */
  notes?: string;
}

export interface SourceReport { overall: string; sources: SourceFinding[]; gaps: string[]; suggestedTitle?: string; createdAt: string }

export interface PlanScene { id: string; title: string; purpose?: string; narration?: string; visuals: string }

export interface Plan {
  title: string;
  summary: string;
  /** e.g. "~90 s", "8 slides", "3 pages". */
  length: string;
  outline: string[];
  /** Scenes (video), slides (deck), sections (doc) or panels (visual). Stable ids. */
  scenes: PlanScene[];
  keyVisuals: string[];
}

export interface Comment { id: string; text: string; createdAt: string; atMs?: number; sceneId?: string }

export interface PlanVersion { n: number; plan: Plan; comments: Comment[]; createdAt: string; model: string; effort: string }

export type ExplainerStatus = 'draft' | 'reported' | 'planned' | 'approved' | 'built';

export interface Explainer {
  id: string;
  title: string;
  brief: string;
  sources: Source[];
  corrections: Comment[];
  styleId: string | null;
  outputType: OutputType;
  model: string;
  effort: string;
  /** Agent surface id for this explainer (sensitive sources may need a narrower one). */
  surface: string;
  status: ExplainerStatus;
  report: SourceReport | null;
  plans: PlanVersion[];
  approvedPlan: number | null;
  createdAt: string;
  updatedAt: string;
}

export class ExplainerStore {
  private lock = new KeyedLock();
  private p: Paths;
  constructor(p: Paths) { this.p = p; }

  dir(id: string) {
    if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error('bad explainer id'), { status: 400 });
    return join(this.p.explainers, id);
  }

  async get(id: string): Promise<Explainer> {
    const e = await readJson<Explainer | null>(join(this.dir(id), 'explainer.json'), null);
    if (!e) throw Object.assign(new Error(`no explainer ${id}`), { status: 404 });
    return e;
  }

  async list(): Promise<Explainer[]> {
    let ids: string[] = [];
    try { ids = await readdir(this.p.explainers); } catch {}
    const out: Explainer[] = [];
    for (const id of ids) {
      const e = await readJson<Explainer | null>(join(this.p.explainers, id, 'explainer.json'), null);
      if (e && e.createdAt) out.push(e);
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(input: Omit<Explainer, 'id' | 'status' | 'report' | 'plans' | 'approvedPlan' | 'createdAt' | 'updatedAt' | 'corrections'>): Promise<Explainer> {
    const now = new Date().toISOString();
    const e: Explainer = { ...input, id: newId('ex_'), corrections: [], status: 'draft', report: null, plans: [], approvedPlan: null, createdAt: now, updatedAt: now };
    await mkdir(this.dir(e.id), { recursive: true });
    await writeJson(join(this.dir(e.id), 'explainer.json'), e);
    return e;
  }

  update(id: string, fn: (e: Explainer) => void | Promise<void>): Promise<Explainer> {
    return this.lock.run(id, async () => {
      const e = await this.get(id);
      await fn(e);
      e.updatedAt = new Date().toISOString();
      await writeJson(join(this.dir(id), 'explainer.json'), e);
      return e;
    });
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await rm(this.dir(id), { recursive: true, force: true });
  }
}

export function normalizeSources(input: unknown): Source[] {
  if (!Array.isArray(input)) return [];
  const kinds: SourceKind[] = ['path', 'url', 'connector', 'note'];
  return input
    .filter((s) => s && typeof s.value === 'string' && s.value.trim())
    .map((s) => ({
      id: typeof s.id === 'string' && /^src_\w+$/.test(s.id) ? s.id : newId('src_'),
      kind: kinds.includes(s.kind) ? s.kind : guessKind(s.value),
      value: s.value.trim(),
      ...(typeof s.label === 'string' && s.label ? { label: s.label } : {}),
      enabled: s.enabled !== false,
    }));
}

function guessKind(v: string): SourceKind {
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^(~|\/|\.\.?\/)/.test(v)) return 'path';
  return 'connector';
}
