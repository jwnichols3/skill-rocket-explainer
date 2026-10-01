import type { AgentSurface, TtsProvider, Renderer } from './types.ts';
import type { Settings, OutputType } from '../settings.ts';
import type { Paths } from '../datadir.ts';
import type { CheckDef } from '../doctor.ts';
import { createFakeAgent } from './fake/agent.ts';
import { createFakeTts } from './fake/tts.ts';
import { createFakeVideoRenderer } from './fake/renderer.ts';
import { createClaudeSurface, claudeChecks, SUBSCRIPTION } from './claude/agent.ts';

export interface ProviderEnv { paths: Paths; settings: () => Settings }

type Factory<T> = {
  label: string;
  create: (env: ProviderEnv) => T;
  /** Prerequisite/connectivity checks, run by doctor when this provider is selected. */
  checks?: CheckDef[];
};

/** Every implementation lives here. Adding a provider = adding an entry. */
export const AGENT_SURFACES: Record<string, Factory<AgentSurface>> = {
  fake: { label: 'Fake agent (tests)', create: (env) => createFakeAgent(() => env.settings().fake ?? {}) },
  'claude-subscription': { label: SUBSCRIPTION.label, create: () => createClaudeSurface(SUBSCRIPTION), checks: claudeChecks(SUBSCRIPTION, { subscription: true }) },
};

export const TTS_PROVIDERS: Record<string, Factory<TtsProvider>> = {
  fake: { label: 'Fake TTS (tests)', create: () => createFakeTts() },
};

export const RENDERERS: Record<string, Factory<Renderer> & { outputTypes: OutputType[] }> = {
  fake: { label: 'Fake renderer (tests)', outputTypes: ['video'], create: () => createFakeVideoRenderer() },
};

export class Providers {
  private cache = new Map<string, unknown>();
  private env: ProviderEnv;
  constructor(env: ProviderEnv) { this.env = env; }

  private get<T>(kind: string, table: Record<string, Factory<T>>, id: string): T {
    const f = table[id];
    if (!f) throw new Error(`no ${kind} named "${id}" (available: ${Object.keys(table).join(', ')})`);
    const key = `${kind}:${id}`;
    if (!this.cache.has(key)) this.cache.set(key, f.create(this.env));
    return this.cache.get(key) as T;
  }

  agent(id = this.env.settings().providers.agent): AgentSurface { return this.get('agent surface', AGENT_SURFACES, id); }
  tts(id = this.env.settings().providers.tts): TtsProvider { return this.get('TTS provider', TTS_PROVIDERS, id); }
  renderer(type: OutputType, id = this.env.settings().providers.renderer[type]): Renderer {
    const r = this.get<Renderer>('renderer', RENDERERS, id);
    if (!r.outputTypes.includes(type)) throw new Error(`renderer "${id}" does not produce ${type}`);
    return r;
  }
  /** Drop cached instances (after settings or secrets change). */
  reset() { this.cache.clear(); }
}

/** Validates the provider block of a settings patch; returns an error message or null. */
export function validateProviders(patch: Partial<Settings['providers']> | undefined): string | null {
  const p: Partial<Settings['providers']> = patch ?? {};
  if (p.agent !== undefined && !AGENT_SURFACES[p.agent]) return `unknown agent surface "${p.agent}" (available: ${Object.keys(AGENT_SURFACES).join(', ')})`;
  if (p.tts !== undefined && !TTS_PROVIDERS[p.tts]) return `unknown TTS provider "${p.tts}" (available: ${Object.keys(TTS_PROVIDERS).join(', ')})`;
  for (const [type, id] of Object.entries(p.renderer ?? {})) {
    const r = RENDERERS[id];
    if (!r) return `unknown renderer "${id}" (available: ${Object.keys(RENDERERS).join(', ')})`;
    if (!r.outputTypes.includes(type as OutputType)) return `renderer "${id}" does not produce ${type}`;
  }
  return null;
}

/** Checks contributed by the providers currently selected in settings. */
export function providerChecks(s: Settings): CheckDef[] {
  const ids = new Set<Factory<unknown>>();
  ids.add(AGENT_SURFACES[s.providers.agent]);
  ids.add(TTS_PROVIDERS[s.providers.tts]);
  for (const id of Object.values(s.providers.renderer)) ids.add(RENDERERS[id]);
  return [...ids].filter(Boolean).flatMap((f) => f.checks ?? []);
}
