import type { AgentSurface, TtsProvider, Renderer } from './types.ts';
import type { Settings, OutputType } from '../settings.ts';
import type { Paths } from '../datadir.ts';
import type { CheckDef } from '../doctor.ts';
import { meterAgent, meterTts } from '../usage.ts';
import { createFakeAgent } from './fake/agent.ts';
import { createFakeTts } from './fake/tts.ts';
import { createFakeVideoRenderer, createFakeDocumentRenderer } from './fake/renderer.ts';
import { createPollyTts, pollyChecks } from './polly/tts.ts';
import { createClaudeSurface, claudeChecks, SUBSCRIPTION, bedrockSurfaceConfig } from './claude/agent.ts';
import { BEDROCK_CHECKS } from './claude/bedrock.ts';
import { createRemotionRenderer } from './remotion/renderer.ts';
import { remotionProjectDir } from './remotion/project.ts';
import { REMOTION_CHECKS } from './remotion/checks.ts';
import { createHyperFramesRenderer } from './hyperframes/renderer.ts';
import { HYPERFRAMES_CHECKS, hyperframesCacheRoot } from './hyperframes/checks.ts';
import { createElevenLabsTts, elevenLabsChecks } from './elevenlabs/tts.ts';
import { getSecret } from '../secrets.ts';
import { createKokoroTts, kokoroChecks } from './kokoro/tts.ts';
import { createVisualRenderer, VISUAL_CHECKS } from './visual/renderer.ts';
import { createDocRenderer, docCacheRoot, DOC_CHECKS } from './doc/renderer.ts';
import { createDeckRenderer } from './deck/renderer.ts';
import { BROWSER_CHECK } from '../browser.ts';

export interface ProviderEnv { paths: Paths; settings: () => Settings }

type Factory<T> = {
  label: string;
  create: (env: ProviderEnv) => T;
  /** Prerequisite/connectivity checks, run by doctor when this provider is selected. */
  checks?: CheckDef[];
  /** Secret names (e.g. 'apiKey') this provider reads from secrets.json; Settings shows a field for each. */
  secrets?: string[];
};

/** Every implementation lives here. Adding a provider = adding an entry. */
export const AGENT_SURFACES: Record<string, Factory<AgentSurface>> = {
  fake: { label: 'Fake agent (tests)', create: (env) => createFakeAgent(() => env.settings().fake ?? {}) },
  'claude-subscription': { label: SUBSCRIPTION.label, create: () => createClaudeSurface(SUBSCRIPTION), checks: claudeChecks(SUBSCRIPTION, { subscription: true }) },
  'claude-bedrock': {
    label: 'Claude Code on Amazon Bedrock', create: (env) => createClaudeSurface(bedrockSurfaceConfig(() => env.settings().bedrock)),
    checks: [...claudeChecks(bedrockSurfaceConfig(() => ({ region: '', models: {} }))), ...BEDROCK_CHECKS],
  },
};

export const TTS_PROVIDERS: Record<string, Factory<TtsProvider>> = {
  fake: { label: 'Fake TTS (tests)', create: () => createFakeTts() },
  polly: { label: 'Amazon Polly', create: (env) => createPollyTts(() => env.settings().polly), checks: pollyChecks },
  elevenlabs: { label: 'ElevenLabs', create: (env) => createElevenLabsTts({ apiKey: () => getSecret(env.paths, 'elevenlabs', 'apiKey') }), checks: elevenLabsChecks(), secrets: ['apiKey'] },
  kokoro: { label: 'Kokoro (local)', create: (env) => createKokoroTts(env.paths), checks: kokoroChecks },
};

export const RENDERERS: Record<string, Factory<Renderer> & { outputTypes: OutputType[] }> = {
  fake: { label: 'Fake renderer (tests)', outputTypes: ['video', 'deck', 'doc', 'visual'], create: () => {
    const video = createFakeVideoRenderer();
    const docs = createFakeDocumentRenderer();
    return { ...video, outputTypes: ['video', 'deck', 'doc', 'visual'], render: (req) => (req.outputType === 'video' ? video : docs).render(req) };
  } },
  remotion: { label: 'Remotion', outputTypes: ['video'], create: (env) => createRemotionRenderer({ projectDir: remotionProjectDir(env.paths.home) }), checks: REMOTION_CHECKS },
  hyperframes: {
    label: 'HyperFrames (HTML + GSAP, Apache-2.0)', outputTypes: ['video'], checks: HYPERFRAMES_CHECKS,
    create: (env) => createHyperFramesRenderer({ cacheRoot: hyperframesCacheRoot(env.paths.home) }),
  },
  'html-visual': { label: 'One-pager (HTML to PNG)', outputTypes: ['visual'], create: () => createVisualRenderer(), checks: VISUAL_CHECKS },
  'markdown-pdf': { label: 'Briefing doc (Markdown to styled PDF)', outputTypes: ['doc'], checks: DOC_CHECKS, create: (env) => createDocRenderer({ cacheRoot: docCacheRoot(env.paths.home) }) },
  'html-deck': { label: 'HTML slides + editable PowerPoint', outputTypes: ['deck'], create: () => createDeckRenderer(), checks: [BROWSER_CHECK] },
};

export class Providers {
  private cache = new Map<string, unknown>();
  private env: ProviderEnv;
  constructor(env: ProviderEnv) { this.env = env; }

  private get<T>(kind: string, table: Record<string, Factory<T>>, id: string): T {
    const f = Object.hasOwn(table, id) ? table[id] : undefined;
    if (!f) throw new Error(`no ${kind} named "${id}" (available: ${Object.keys(table).join(', ')})`);
    const key = `${kind}:${id}`;
    if (!this.cache.has(key)) this.cache.set(key, f.create(this.env));
    return this.cache.get(key) as T;
  }

  // Metered: calls made inside a job count toward that job's usage (src/usage.ts).
  agent(id = this.env.settings().providers.agent): AgentSurface { return this.metered('agent', () => meterAgent(this.get('agent surface', AGENT_SURFACES, id)), id); }
  tts(id = this.env.settings().providers.tts): TtsProvider { return this.metered('tts', () => meterTts(this.get('TTS provider', TTS_PROVIDERS, id)), id); }
  private metered<T>(kind: string, make: () => T, id: string): T {
    const key = `metered:${kind}:${id}`;
    if (!this.cache.has(key)) this.cache.set(key, make());
    return this.cache.get(key) as T;
  }
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
  if (p.agent !== undefined && !Object.hasOwn(AGENT_SURFACES, p.agent)) return `unknown agent surface "${p.agent}" (available: ${Object.keys(AGENT_SURFACES).join(', ')})`;
  if (p.tts !== undefined && !Object.hasOwn(TTS_PROVIDERS, p.tts)) return `unknown TTS provider "${p.tts}" (available: ${Object.keys(TTS_PROVIDERS).join(', ')})`;
  for (const [type, id] of Object.entries(p.renderer ?? {})) {
    const r = Object.hasOwn(RENDERERS, id) ? RENDERERS[id] : undefined;
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
  const seen = new Set<string>();
  return [...ids].filter(Boolean).flatMap((f) => f.checks ?? []).filter((c) => !seen.has(c.id) && !!seen.add(c.id));
}
