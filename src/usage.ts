import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSurface, TtsProvider } from './providers/types.ts';

/**
 * Token and cost accounting. Every agent and TTS call made inside a job is metered through
 * the job's async context, so pipeline steps and renderers don't have to report anything.
 * Each finished job appends one entry to its explainer's or style's usage.jsonl.
 */

export interface UsageEntry {
  jobId: string;
  kind: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  at: string;
  models: string[];
  agentRuns: number;
  inputTokens: number;
  outputTokens: number;
  /** Claude Code's own figure: API list price, so an estimate on a subscription. */
  agentCostUsd: number;
  ttsChars: number;
  /** Null when a provider's price depends on the user's plan. */
  ttsCostUsd: number | null;
  costUsd: number;
}

export interface UsageTotals {
  agentRuns: number;
  inputTokens: number;
  outputTokens: number;
  ttsChars: number;
  costUsd: number;
  /** Some narration has no known price, so costUsd leaves it out. */
  ttsUnpriced: boolean;
}

// aws.amazon.com/polly/pricing, checked 2026-10-01: USD per 1M characters. Engines with native
// word timings make a second (speech marks) request on the same text, billed at the same rate.
const POLLY_PER_M: Record<string, number> = { standard: 4, neural: 16, 'long-form': 100, generative: 30 };
const POLLY_SPEECH_MARKS = new Set(['standard', 'neural', 'long-form']);

/** Estimated narration cost in USD, or null when it depends on the user's plan. */
export function ttsCostUsd(provider: string, voiceId: string, chars: number): number | null {
  if (provider === 'polly') {
    const engine = voiceId.split(':')[1] ?? '';
    const rate = POLLY_PER_M[engine];
    if (rate === undefined) return null;
    return (chars / 1_000_000) * rate * (POLLY_SPEECH_MARKS.has(engine) ? 2 : 1);
  }
  if (provider === 'kokoro' || provider === 'fake') return 0;
  return null;
}

class Meter {
  models = new Set<string>();
  agentRuns = 0;
  inputTokens = 0;
  outputTokens = 0;
  agentCostUsd = 0;
  ttsChars = 0;
  ttsCostUsd: number | null = 0;
  get used() { return this.agentRuns > 0 || this.ttsChars > 0; }
}

const current = new AsyncLocalStorage<Meter>();

/** The surface, reporting each run's usage to the job it runs in. */
export function meterAgent(surface: AgentSurface): AgentSurface {
  // Inherits everything else from the original, whatever its shape (object or class instance).
  return Object.assign(Object.create(surface), {
    async run(task: Parameters<AgentSurface['run']>[0], opts: Parameters<AgentSurface['run']>[1]) {
      const res = await surface.run(task, opts);
      const m = current.getStore();
      if (m) {
        m.agentRuns++;
        m.models.add(opts.model);
        m.inputTokens += res.usage?.inputTokens ?? 0;
        m.outputTokens += res.usage?.outputTokens ?? 0;
        m.agentCostUsd += res.usage?.costUsd ?? 0;
      }
      return res;
    },
  });
}

/** The provider, reporting each synthesized character to the job it runs in. */
export function meterTts(tts: TtsProvider): TtsProvider {
  return Object.assign(Object.create(tts), {
    async synthesize(text: string, voiceId: string, controls: Parameters<TtsProvider['synthesize']>[2], outFile: string) {
      const out = await tts.synthesize(text, voiceId, controls, outFile);
      const m = current.getStore();
      if (m) {
        m.ttsChars += text.length;
        const cost = ttsCostUsd(tts.id, voiceId, text.length);
        m.ttsCostUsd = cost === null || m.ttsCostUsd === null ? null : m.ttsCostUsd + cost;
      }
      return out;
    },
  });
}

/** Runs a job body under a fresh meter; returns the entry to record (null if nothing was spent). */
export async function metered<T>(job: { id: string; kind: string; signal: AbortSignal }, fn: () => Promise<T>, record: (e: UsageEntry) => Promise<void>): Promise<T> {
  const m = new Meter();
  let status: UsageEntry['status'] = 'succeeded';
  try {
    return await current.run(m, fn);
  } catch (err) {
    status = job.signal.aborted ? 'cancelled' : 'failed';
    throw err;
  } finally {
    if (m.used) {
      await record({
        jobId: job.id, kind: job.kind, status, at: new Date().toISOString(), models: [...m.models],
        agentRuns: m.agentRuns, inputTokens: m.inputTokens, outputTokens: m.outputTokens, agentCostUsd: m.agentCostUsd,
        ttsChars: m.ttsChars, ttsCostUsd: m.ttsCostUsd, costUsd: m.agentCostUsd + (m.ttsCostUsd ?? 0),
      });
    }
  }
}

const file = (dir: string) => join(dir, 'usage.jsonl');

/** Appends to an existing explainer or style; one deleted mid-job is not recreated. */
export async function appendUsage(dir: string, e: UsageEntry): Promise<void> {
  if (!(await stat(dir).catch(() => null))?.isDirectory()) return;
  await appendFile(file(dir), JSON.stringify(e) + '\n');
}

export async function readUsage(dir: string): Promise<{ entries: UsageEntry[]; totals: UsageTotals }> {
  const text = await readFile(file(dir), 'utf8').catch(() => '');
  const entries: UsageEntry[] = text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const totals: UsageTotals = { agentRuns: 0, inputTokens: 0, outputTokens: 0, ttsChars: 0, costUsd: 0, ttsUnpriced: false };
  for (const e of entries) {
    totals.agentRuns += e.agentRuns;
    totals.inputTokens += e.inputTokens;
    totals.outputTokens += e.outputTokens;
    totals.ttsChars += e.ttsChars;
    totals.costUsd += e.costUsd;
    if (e.ttsCostUsd === null && e.ttsChars > 0) totals.ttsUnpriced = true;
  }
  return { entries, totals };
}
