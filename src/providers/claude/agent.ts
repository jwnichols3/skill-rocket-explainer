import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentSurface, AgentTask, AgentRunOptions, AgentResult, AgentUsage, AgentFailureKind } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { exec } from '../../media.ts';
import { commandVersion } from '../../doctor.ts';

/**
 * Agent surface backed by headless Claude Code (`claude -p`). One factory, several
 * variants: the subscription variant uses the logged-in claude.ai account; a Bedrock
 * variant can supply its own env (CLAUDE_CODE_USE_BEDROCK, AWS_PROFILE, ...).
 */
export interface ClaudeSurfaceConfig {
  id: string;
  label: string;
  /** Extra env for the child, applied after stripping. */
  env?: () => Record<string, string>;
  /** Inherited env vars to remove. A trailing `*` matches a prefix. */
  stripEnv?: string[];
  /** CLI binary. */
  bin?: string;
  /** Hard limit per run. */
  timeoutMs?: number;
}

export const DEFAULT_TOOLS = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
const DEFAULT_TIMEOUT_MS = 30 * 60_000;

/**
 * Vars a parent Claude Code session leaks into its children (session ids, IPC sockets,
 * effort). Dropped for every variant so the child is a clean, independent session.
 * CLAUDE_CONFIG_DIR and CLAUDE_CODE_OAUTH_TOKEN select the account and are kept.
 */
const KEEP_CLAUDE_ENV = new Set(['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN']);

export const SUBSCRIPTION: ClaudeSurfaceConfig = {
  id: 'claude-subscription',
  label: 'Claude Code (subscription)',
  // Anything that would route the CLI to the API, Bedrock, Vertex or a proxy instead of the subscription.
  stripEnv: ['ANTHROPIC_*', 'AWS_*', 'CLAUDE_CODE_USE_*'],
};

export function childEnv(cfg: ClaudeSurfaceConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const strip = cfg.stripEnv ?? [];
  const matches = (k: string) => strip.some((p) => (p.endsWith('*') ? k.startsWith(p.slice(0, -1)) : k === p));
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^CLAUDE/.test(k) && !KEEP_CLAUDE_ENV.has(k)) continue;
    if (matches(k)) continue;
    env[k] = v;
  }
  return { ...env, ...(cfg.env?.() ?? {}) };
}

const SYSTEM_SUFFIX = `You are running headless inside Rocket Explainer. There is no user to ask: never ask questions, make sensible choices and finish the task.
Your working directory is your whole world: read inputs from it and write every file into it. Never write outside it.
Use relative paths for files in your working directory.`;

/** `pluginDirs`: directories loaded as session-only plugins (how workdir skills reach a --restricted session). */
export function claudeArgs(task: AgentTask, opts: AgentRunOptions, pluginDirs: string[] = []): string[] {
  const list = task.tools?.length ? task.tools : DEFAULT_TOOLS;
  const tools = list.join(',');
  return [
    '-p',
    '--output-format', 'stream-json', '--verbose',
    '--model', opts.model,
    '--effort', opts.effort,
    // Only these tools exist in the session, and they run without prompting.
    '--tools', tools,
    '--allowedTools', tools,
    // Edits inside the working dirs are auto-accepted; anything that would prompt is denied.
    '--permission-mode', 'acceptEdits',
    '--permission-prompts', 'none',
    // Confines file tools to cwd + --add-dir, ignores user/project settings (hooks, plugins, env).
    '--restricted',
    '--strict-mcp-config',
    // Skills stay off unless the task asks for the Skill tool.
    ...(list.includes('Skill') ? pluginDirs.flatMap((d) => ['--plugin-dir', d]) : ['--disable-slash-commands']),
    '--no-session-persistence',
    '--append-system-prompt', SYSTEM_SUFFIX,
    ...(task.readDirs ?? []).flatMap((d) => ['--add-dir', resolve(d)]),
    '--', task.prompt,
  ];
}

const exists = (f: string) => access(f).then(() => true, () => false);
const tail = (s: string, n = 1500) => (s.length > n ? '...' + s.slice(-n) : s).trim();

function usageOf(r: any): AgentUsage {
  if (!r) return {};
  const u = r.usage ?? {};
  const input = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  return {
    inputTokens: u.input_tokens === undefined ? undefined : input,
    outputTokens: u.output_tokens,
    costUsd: r.total_cost_usd,
    durationMs: r.duration_ms,
  };
}

/** Classifies a CLI error message. */
export function failureKind(message: string): AgentFailureKind {
  if (/not logged in|please run \/login|\/login|invalid api key|authentication|oauth token|unauthori[sz]ed|\b401\b|credit balance|x-api-key/i.test(message)) return 'auth';
  return 'failed';
}

/** One readable log line per stream-json event worth showing. */
function logLine(ev: any): string | null {
  if (ev.type === 'system' && ev.subtype === 'init') return `claude: session started (model ${ev.model}, tools ${(ev.tools ?? []).join(', ')})`;
  if (ev.type === 'assistant') {
    const out: string[] = [];
    for (const c of ev.message?.content ?? []) {
      if (c.type === 'text' && c.text?.trim()) out.push(`claude: ${c.text.trim().replace(/\s+/g, ' ').slice(0, 300)}`);
      if (c.type === 'tool_use') out.push(`claude: ${c.name} ${c.input?.file_path ?? c.input?.pattern ?? c.input?.path ?? c.input?.skill ?? ''}`.trimEnd());
    }
    return out.join('\n') || null;
  }
  if (ev.type === 'user') {
    for (const c of ev.message?.content ?? []) if (c.type === 'tool_result' && c.is_error) return `claude: tool error: ${String(typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 300)}`;
  }
  if (ev.type === 'result') return `claude: ${ev.is_error ? 'error' : ev.subtype} in ${ev.duration_ms} ms, ${ev.num_turns} turns, $${ev.total_cost_usd ?? '?'}`;
  return null;
}

export function createClaudeSurface(cfg: ClaudeSurfaceConfig): AgentSurface {
  const bin = cfg.bin ?? 'claude';
  return {
    id: cfg.id,
    label: cfg.label,
    async run(task: AgentTask, opts: AgentRunOptions): Promise<AgentResult> {
      const fail = (kind: AgentFailureKind, message: string, usage?: AgentUsage): AgentResult => ({ ok: false, error: { kind, message }, usage });
      if (opts.signal?.aborted) return fail('cancelled', 'cancelled before start');
      const workdir = resolve(opts.workdir);
      try {
        await mkdir(workdir, { recursive: true });
        await writeFile(join(workdir, 'inputs.json'), JSON.stringify(task.inputs, null, 2));
        // A stale result from an earlier run in the same dir must not pass for this run's.
        if (task.resultFile) await rm(join(workdir, task.resultFile), { force: true });
      } catch (err: any) {
        return fail('failed', `could not prepare workdir ${workdir}: ${err?.message ?? err}`);
      }

      const ctl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      // --restricted ignores project skills, so <workdir>/.claude (with skills/) is loaded as a plugin instead.
      // Its skills then show up as ".claude:<name>".
      const pluginDirs = (await exists(join(workdir, '.claude', 'skills'))) ? [join(workdir, '.claude')] : [];

      let result: any = null;
      const r = await exec(bin, claudeArgs(task, opts, pluginDirs), {
        cwd: workdir,
        env: childEnv(cfg),
        signal: ctl.signal,
        onLine: (line) => {
          if (!line.trim()) return;
          let ev: any;
          try { ev = JSON.parse(line); } catch { opts.onLog?.(`claude: ${line}`); return; }
          if (ev?.type === 'result') result = ev;
          const l = logLine(ev);
          if (l) for (const x of l.split('\n')) opts.onLog?.(x);
        },
      }).finally(() => { clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); });

      const usage = usageOf(result);
      if (opts.signal?.aborted) return fail('cancelled', 'cancelled', usage);
      if (timedOut) return fail('timeout', `claude did not finish within ${Math.round((cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} s`, usage);
      if (r.code === 127) return fail('unavailable', `the "${bin}" CLI was not found; install Claude Code: https://docs.claude.com/claude-code`);
      if (!result || result.is_error || r.code !== 0) {
        const msg = (result?.is_error ? String(result.result ?? result.subtype ?? '') : '') || tail(r.stderr) || `claude exited with code ${r.code}`;
        return fail(failureKind(msg), msg, usage);
      }

      for (const f of task.expectFiles ?? []) {
        if (!(await exists(join(workdir, f)))) return fail('invalid-output', `agent did not write ${f}`, usage);
      }
      if (!task.resultFile) return { ok: true, output: result.result, usage };
      let text: string;
      try { text = await readFile(join(workdir, task.resultFile), 'utf8'); } catch {
        return fail('invalid-output', `agent did not write ${task.resultFile}. Its last message: ${tail(String(result.result ?? ''), 500)}`, usage);
      }
      try { return { ok: true, output: JSON.parse(text), usage }; } catch (err: any) {
        return fail('invalid-output', `${task.resultFile} is not valid JSON: ${err.message}`, usage);
      }
    },
  };
}

/** Doctor checks for a Claude Code variant: CLI present, and (subscription) logged in. */
export function claudeChecks(cfg: ClaudeSurfaceConfig, opts: { subscription?: boolean } = {}): CheckDef[] {
  const bin = cfg.bin ?? 'claude';
  const checks: CheckDef[] = [{
    id: `${cfg.id}-cli`, label: 'Claude Code CLI',
    async run() {
      const v = await commandVersion(bin);
      return v ? { ok: true, detail: v } : { ok: false, detail: 'missing', fix: 'install Claude Code: https://docs.claude.com/claude-code' };
    },
  }];
  if (opts.subscription) checks.push({
    id: `${cfg.id}-auth`, label: 'Claude subscription login', optional: true,
    async run() {
      const r = await exec(bin, ['auth', 'status'], { env: childEnv(cfg), timeoutMs: 15000 });
      let s: any = null;
      try { s = JSON.parse(r.stdout); } catch {}
      if (s?.loggedIn && s.authMethod === 'claude.ai') return { ok: true, detail: `logged in${s.subscriptionType ? ` (${s.subscriptionType})` : ''}` };
      const detail = s?.loggedIn ? `logged in via ${s.authMethod}, not a claude.ai subscription` : 'not logged in';
      return { ok: false, detail, fix: 'run `claude auth login` and sign in with your Claude subscription' };
    },
  });
  return checks;
}
