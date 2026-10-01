import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from './datadir.ts';
import { readJson, writeJson } from './datadir.ts';
import { newId } from './lock.ts';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobState {
  id: string;
  kind: string;
  /** What the job works on, e.g. 'style:st_abc'. One active job per target. */
  target: string;
  status: JobStatus;
  stage: string;
  /** 0..1, or null when indeterminate. */
  progress: number | null;
  /** Extra detail for the UI, e.g. current scene. */
  detail: string | null;
  log: string[];
  error: string | null;
  result: unknown;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface JobCtx {
  stage(name: string, progress?: number | null, detail?: string | null): void;
  progress(p: number | null, detail?: string | null): void;
  log(line: string): void;
  signal: AbortSignal;
  id: string;
}

export class ConflictError extends Error {
  job: JobState;
  constructor(job: JobState) {
    super(`another job (${job.kind}) is already running for this item`);
    this.job = job;
  }
}

const MAX_LOG = 2000;

/**
 * In-process background jobs. State is mirrored to jobs/<id>.json so logs outlive the
 * job and the page can reload. Jobs do not survive a server restart: on start, any job
 * left running is marked failed.
 */
export class JobRunner {
  private jobs = new Map<string, JobState>();
  private controllers = new Map<string, AbortController>();
  private flushTimers = new Map<string, NodeJS.Timeout>();
  private p: Paths;
  private onError: (msg: string) => void;
  constructor(p: Paths, onError: (msg: string) => void = () => {}) { this.p = p; this.onError = onError; }

  async init(): Promise<void> {
    let files: string[] = [];
    try { files = await readdir(this.p.jobs); } catch {}
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      const job = await readJson<JobState | null>(join(this.p.jobs, f), null);
      if (!job) continue;
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.error = 'the app restarted while this job was running';
        job.endedAt = new Date().toISOString();
        job.log.push(`[${job.endedAt}] ${job.error}`);
        await writeJson(join(this.p.jobs, f), job);
      }
      this.jobs.set(job.id, job);
    }
  }

  get(id: string): JobState | undefined { return this.jobs.get(id); }

  list(filter: { target?: string; active?: boolean } = {}): JobState[] {
    return [...this.jobs.values()]
      .filter((j) => !filter.target || j.target === filter.target)
      .filter((j) => !filter.active || j.status === 'queued' || j.status === 'running')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  active(target: string): JobState | undefined {
    return this.list({ target, active: true })[0];
  }

  /** Starts a job; throws ConflictError if the target already has an active one. */
  start(kind: string, target: string, fn: (ctx: JobCtx) => Promise<unknown>): JobState {
    const existing = this.active(target);
    if (existing) throw new ConflictError(existing);
    const now = new Date().toISOString();
    const job: JobState = {
      id: newId('job_'), kind, target, status: 'queued', stage: 'queued', progress: 0, detail: null,
      log: [], error: null, result: null, createdAt: now, startedAt: null, endedAt: null,
    };
    this.jobs.set(job.id, job);
    const ac = new AbortController();
    this.controllers.set(job.id, ac);
    const ctx: JobCtx = {
      id: job.id,
      signal: ac.signal,
      stage: (name, progress = null, detail = null) => {
        job.stage = name; job.progress = progress; job.detail = detail;
        this.push(job, `== ${name}${detail ? `: ${detail}` : ''}`);
      },
      progress: (p, detail) => { job.progress = p; if (detail !== undefined) job.detail = detail; this.flushSoon(job); },
      log: (line) => this.push(job, line),
    };
    this.flush(job);
    queueMicrotask(async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      this.flush(job);
      try {
        job.result = (await fn(ctx)) ?? null;
        job.status = ac.signal.aborted ? 'cancelled' : 'succeeded';
        job.stage = job.status === 'succeeded' ? 'done' : 'cancelled';
        job.progress = 1;
      } catch (err: any) {
        job.status = ac.signal.aborted ? 'cancelled' : 'failed';
        job.error = String(err?.message ?? err);
        this.push(job, `ERROR: ${job.error}`);
        if (err?.stack) this.onError(`job ${job.id} (${kind}) failed: ${err.stack}`);
      } finally {
        job.endedAt = new Date().toISOString();
        this.controllers.delete(job.id);
        this.flush(job);
      }
    });
    return job;
  }

  cancel(id: string): boolean {
    const ac = this.controllers.get(id);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  async shutdown(): Promise<void> {
    for (const ac of this.controllers.values()) ac.abort();
    for (const t of this.flushTimers.values()) clearTimeout(t);
  }

  private push(job: JobState, line: string) {
    for (const l of line.split('\n')) job.log.push(l);
    if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
    this.flushSoon(job);
  }

  private flushSoon(job: JobState) {
    if (this.flushTimers.has(job.id)) return;
    this.flushTimers.set(job.id, setTimeout(() => { this.flushTimers.delete(job.id); this.flush(job); }, 250));
  }

  private flush(job: JobState) {
    writeJson(join(this.p.jobs, `${job.id}.json`), job).catch((err) => this.onError(`job flush failed: ${err}`));
  }
}
