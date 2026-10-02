import { readJson, writeJson, type Paths } from './datadir.ts';

export type OutputType = 'video' | 'deck' | 'doc' | 'visual';
export const OUTPUT_TYPES: OutputType[] = ['video', 'deck', 'doc', 'visual'];

export interface Settings {
  port: number;
  /** Bind address. Loopback only. */
  host: string;
  /** Extra hostnames (e.g. a reverse proxy on a dev box) allowed in Host and Origin. */
  publicHostnames: string[];
  providers: {
    agent: string;
    tts: string;
    renderer: Record<OutputType, string>;
  };
  /** Model dropdown entries (Claude model ids). */
  models: { id: string; label: string }[];
  efforts: string[];
  defaults: { model: string; effort: string };
  /** Amazon Polly. Empty profile = the default AWS credential chain. */
  polly: { region: string; profile?: string };
  /** First-run setup confirmed (CLI --yes or the web Setup page). */
  setupComplete?: boolean;
  /** Where the browser reaches the app when it runs behind a reverse proxy, e.g. https://explainer.devbox.example. */
  publicUrl?: string;
  /** Set once seed styles have been copied in, so deleting one doesn't bring it back. */
  seeded?: boolean;
  /**
   * Claude Code on Amazon Bedrock (agent surface `claude-bedrock`). Empty profile = the
   * `default` AWS profile. `models` maps app model ids to Bedrock inference profile ids
   * or ARNs; an empty value means unmapped.
   */
  bedrock: { profile?: string; region: string; models: Record<string, string> };
  /** Test-only knobs for the fake providers. */
  fake?: { failKinds?: string[]; delayMs?: number };
}

export const DEFAULT_SETTINGS: Settings = {
  port: 4870,
  host: '127.0.0.1',
  publicHostnames: [],
  // Real providers by default; tests select the fakes explicitly.
  providers: {
    agent: 'claude-subscription',
    tts: 'polly',
    renderer: { video: 'hyperframes', deck: 'html-deck', doc: 'markdown-pdf', visual: 'html-visual' },
  },
  models: [
    { id: 'claude-opus-5-5', label: 'Opus 5.5' },
    { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  ],
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  defaults: { model: 'claude-opus-5-5', effort: 'high' },
  polly: { region: 'us-east-1' },
  bedrock: { region: 'us-east-1', models: {} },
};

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge for plain objects; arrays and scalars replace. */
export function merge<T>(base: T, patch: unknown): T {
  if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = merge((base as any)[k], v);
  return out as T;
}

export async function loadSettings(p: Paths): Promise<Settings> {
  return merge(DEFAULT_SETTINGS, await readJson(p.settings, {}));
}

export async function saveSettings(p: Paths, patch: unknown): Promise<Settings> {
  const next = merge(await loadSettings(p), patch);
  await writeJson(p.settings, next);
  return next;
}

/** Checks the model list, defaults and Bedrock block of a merged settings object; returns an error message or null. */
/** Shapes of AWS region and profile names, for settings and query parameters. */
export const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;
export const AWS_PROFILE = /^[\w.+@-]+$/;

export function validateSettings(s: Settings): string | null {
  // No auth: the app must only ever listen on loopback (a reverse proxy reaches it from there).
  if (!['127.0.0.1', 'localhost', '::1'].includes(s.host)) return `host must be a loopback address (127.0.0.1, localhost or ::1), not "${s.host}"`;
  if (!Number.isInteger(s.port) || s.port < 0 || s.port > 65535) return `port must be 0-65535, not ${JSON.stringify(s.port)}`;
  if (!Array.isArray(s.publicHostnames) || s.publicHostnames.some((h) => typeof h !== 'string' || !/^[a-z0-9.-]+(:\d+)?$/i.test(h))) return 'publicHostnames must be a list of host names';
  if (s.publicUrl !== undefined && typeof s.publicUrl !== 'string') return 'publicUrl must be a URL';
  if (!Array.isArray(s.models) || !s.models.length) return 'the model list cannot be empty';
  const ids = new Set<string>();
  for (const m of s.models) {
    if (!m || typeof m.id !== 'string' || !m.id.trim() || typeof m.label !== 'string') return 'each model needs an id and a label';
    if (ids.has(m.id)) return `model "${m.id}" is listed twice`;
    ids.add(m.id);
  }
  if (!Array.isArray(s.efforts) || !s.efforts.length || s.efforts.some((e) => typeof e !== 'string' || !e)) return 'efforts must be a non-empty list of names';
  if (!ids.has(s.defaults.model)) return `the default model "${s.defaults.model}" is not in the model list`;
  if (!s.efforts.includes(s.defaults.effort)) return `the default effort "${s.defaults.effort}" is not one of ${s.efforts.join(', ')}`;
  const pl = s.polly;
  if (!isObject(pl) || typeof pl.region !== 'string' || !AWS_REGION.test(pl.region)) return `polly.region must be an AWS region, not ${JSON.stringify(pl?.region)}`;
  if (pl.profile !== undefined && (typeof pl.profile !== 'string' || (pl.profile && !AWS_PROFILE.test(pl.profile)))) return `polly.profile must be an AWS profile name, not ${JSON.stringify(pl.profile)}`;
  const b = s.bedrock;
  if (!isObject(b) || typeof b.region !== 'string' || !isObject(b.models)) return 'bedrock needs a region and a models map';
  if (b.profile !== undefined && typeof b.profile !== 'string') return 'bedrock.profile must be a profile name';
  if (Object.values(b.models).some((v) => typeof v !== 'string')) return 'bedrock.models values must be inference profile ids';
  return null;
}
