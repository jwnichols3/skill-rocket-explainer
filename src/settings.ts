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
  /** Set once seed styles have been copied in, so deleting one doesn't bring it back. */
  seeded?: boolean;
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
