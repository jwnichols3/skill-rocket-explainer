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
  providers: {
    agent: 'fake',
    tts: 'fake',
    renderer: { video: 'fake', deck: 'fake', doc: 'fake', visual: 'fake' },
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
export function validateSettings(s: Settings): string | null {
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
  const b = s.bedrock;
  if (!isObject(b) || typeof b.region !== 'string' || !isObject(b.models)) return 'bedrock needs a region and a models map';
  if (b.profile !== undefined && typeof b.profile !== 'string') return 'bedrock.profile must be a profile name';
  if (Object.values(b.models).some((v) => typeof v !== 'string')) return 'bedrock.models values must be inference profile ids';
  return null;
}
