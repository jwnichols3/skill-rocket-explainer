import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { AgentSurface, AgentTask, AgentRunOptions, AgentResult } from '../types.ts';

export type Responder = (inputs: Record<string, any>, task: AgentTask) => unknown;

/** Canned outputs keyed by task kind. Deterministic, derived from inputs so tests can see their effect. */
export const responders: Record<string, Responder> = {};

export interface FakeAgentKnobs { failKinds?: string[]; delayMs?: number }

export function createFakeAgent(knobs: () => FakeAgentKnobs): AgentSurface {
  return {
    id: 'fake',
    label: 'Fake agent (canned, for tests)',
    async run(task: AgentTask, opts: AgentRunOptions): Promise<AgentResult> {
      const k = knobs();
      const started = Date.now();
      await mkdir(opts.workdir, { recursive: true });
      await writeFile(join(opts.workdir, 'inputs.json'), JSON.stringify(task.inputs, null, 2));
      opts.onLog?.(`fake agent: ${task.kind} (model ${opts.model}, effort ${opts.effort})`);
      if (k.delayMs) await new Promise((r) => setTimeout(r, k.delayMs));
      if (opts.signal?.aborted) return { ok: false, error: { kind: 'cancelled', message: 'cancelled' } };
      if (k.failKinds?.includes(task.kind)) return { ok: false, error: { kind: 'failed', message: `fake failure for ${task.kind}` } };
      const responder = responders[task.kind];
      if (!responder) return { ok: false, error: { kind: 'failed', message: `fake agent has no canned output for task "${task.kind}"` } };
      const raw = (await responder(task.inputs, task)) as any;
      // Responders return { __files: { 'scene.tsx': '...' }, ...output } to stand in for files a real agent writes.
      const { __files, ...output } = raw ?? {};
      for (const [name, content] of Object.entries((__files ?? {}) as Record<string, string>)) {
        const target = join(opts.workdir, name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      for (const f of task.expectFiles ?? []) {
        if (!(__files ?? {})[f]) return { ok: false, error: { kind: 'invalid-output', message: `agent did not write ${f}` } };
      }
      if (task.resultFile) await writeFile(join(opts.workdir, task.resultFile), JSON.stringify(output, null, 2));
      return { ok: true, output, usage: { inputTokens: 1200, outputTokens: 300, costUsd: 0.02, durationMs: Date.now() - started } };
    },
  };
}
