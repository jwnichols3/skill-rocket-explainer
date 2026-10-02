import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentSurface, AgentTask, AgentRunOptions, AgentResult, AgentUsage, AgentFailureKind } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { exec } from '../../media.ts';
import { commandVersion } from '../../doctor.ts';
import { fromIni } from '@aws-sdk/credential-providers';
import type { BedrockScope } from '../../settings.ts';

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
  /** Maps the app's model id to what `--model` gets; `{ error }` = this variant can't run it. Default: as is. */
  model?: (id: string) => string | { error: string };
  /** Extra messages that mean "not signed in" for this variant, and the fix appended to auth failures. */
  authPattern?: RegExp;
  authFix?: () => string;
  /** Runs before the CLI starts; a message means "not signed in" (auth failure) and the run stops there. */
  preflight?: () => Promise<string | null>;
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

export interface BedrockConfig { profile?: string; region: string; scope?: BedrockScope; models: Record<string, string> }

/**
 * ANTHROPIC_BEDROCK_REGION_PREFIX for a scope: the cross-region prefix Claude Code prefers for
 * ids it resolves itself. None for in-region, for geos Claude Code has no prefix for, and in
 * GovCloud (Claude Code forces `us-gov.` there).
 */
function regionPrefix(scope: BedrockScope, region: string): string | undefined {
  if (region.startsWith('us-gov-') || scope === 'in-region') return undefined;
  if (scope === 'global') return 'global';
  if (/^(us|ca)-/.test(region)) return 'us';
  if (region.startsWith('eu-')) return 'eu';
  if (['ap-northeast-1', 'ap-northeast-3'].includes(region)) return 'jp';
  if (['ap-southeast-2', 'ap-southeast-4'].includes(region)) return 'au';
  return undefined;
}

/** Values that already are Bedrock model ids: inference profile ids (`us.anthropic.…`), foundation model ids or ARNs. */
const BEDROCK_ID = /^(arn:aws[\w-]*:bedrock:|([a-z-]+\.)?anthropic\.)/;

/** Maps an app model id to a Bedrock inference profile per settings; ids that already are Bedrock ids pass through. */
export function bedrockModel(b: BedrockConfig, id: string): string | { error: string } {
  const mapped = b.models?.[id]?.trim();
  if (mapped) return mapped;
  if (BEDROCK_ID.test(id)) return id;
  return { error: `model "${id}" has no Bedrock inference profile mapped; map it in Settings > Models & agents > Amazon Bedrock (use Discover), or pick another model or surface` };
}

export function bedrockAuthFix(b: { profile?: string }): string {
  const p = b.profile || 'default';
  return `run \`aws sso login --profile ${p}\` (or refresh that profile's keys); the profile is set in Settings > Models & agents > Amazon Bedrock`;
}

/** Messages from Claude Code / the AWS SDK that mean the AWS credentials are missing or expired. */
const AWS_AUTH = /sso session|token (has )?expired|expiredtoken|could not load credentials|unable to locate credentials|credentials? (are|is) (missing|expired|invalid)|unrecognizedclient|security token included in the request is (invalid|expired)|aws authentication failed|session token not found|invalidclienttokenid|refresh failed/i;

/**
 * Claude Code on Amazon Bedrock with the AWS profile and region from settings. The
 * subscription's account vars and any inherited AWS credentials/profile are dropped, then
 * CLAUDE_CODE_USE_BEDROCK, AWS_PROFILE, AWS_REGION and ANTHROPIC_BEDROCK_REGION_PREFIX (from
 * the routing scope) are set. AWS_CONFIG_FILE and
 * AWS_SHARED_CREDENTIALS_FILE are kept so non-default config paths keep working.
 */
export function bedrockSurfaceConfig(bedrock: () => BedrockConfig): ClaudeSurfaceConfig {
  return {
    id: 'claude-bedrock',
    label: 'Claude Code on Amazon Bedrock',
    stripEnv: ['ANTHROPIC_*', 'CLAUDE_CODE_USE_*', 'CLAUDE_CODE_OAUTH_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
      'AWS_BEARER_TOKEN_BEDROCK', 'AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'ANTHROPIC_BEDROCK_REGION_PREFIX'],
    env: () => {
      const b = bedrock();
      const prefix = regionPrefix(b.scope ?? 'global', b.region);
      return { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: b.region, ...(b.profile ? { AWS_PROFILE: b.profile } : {}), ...(prefix ? { ANTHROPIC_BEDROCK_REGION_PREFIX: prefix } : {}) };
    },
    model: (id) => bedrockModel(bedrock(), id),
    authPattern: AWS_AUTH,
    authFix: () => bedrockAuthFix(bedrock()),
    // Claude Code retries credential errors for a long time; resolving them first fails fast instead.
    preflight: () => awsCredentialsError(bedrock().profile),
  };
}

/** Resolves the profile's credentials (SSO, role, process, keys); returns the error message, or null when usable. */
export async function awsCredentialsError(profile?: string): Promise<string | null> {
  try {
    await fromIni({ profile: profile || 'default' })();
    return null;
  } catch (err: any) {
    return `AWS credentials for profile ${profile || 'default'} are not usable: ${err?.message ?? err}`;
  }
}

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
      const model = cfg.model ? cfg.model(opts.model) : opts.model;
      if (typeof model !== 'string') return fail('unavailable', model.error);
      const signedOut = await cfg.preflight?.();
      if (signedOut) return fail('auth', cfg.authFix ? `${signedOut}. Fix: ${cfg.authFix()}` : signedOut);
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
      const r = await exec(bin, claudeArgs(task, { ...opts, model }, pluginDirs), {
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
        const kind = cfg.authPattern?.test(msg) ? 'auth' : failureKind(msg);
        return fail(kind, kind === 'auth' && cfg.authFix ? `${msg}. Fix: ${cfg.authFix()}` : msg, usage);
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
