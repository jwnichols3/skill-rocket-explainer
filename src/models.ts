import { join } from 'node:path';
import { readJson, writeJson } from './datadir.ts';
import { discovery, baseModel } from './providers/claude/bedrock.ts';
import type { Settings } from './settings.ts';

/**
 * Models offered in Settings' dropdowns. Claude Code has no command that lists models and the
 * subscription has no models API, so a built-in list of current Claude models is always there;
 * Refresh adds what Bedrock offers in the configured region.
 */

export interface AvailableModel { id: string; label: string; sources: ('built-in' | 'bedrock')[] }
export interface ModelCatalog { models: AvailableModel[]; fetchedAt: string | null; problems: { source: string; message: string }[] }

export const KNOWN_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
];

const builtIn = (): AvailableModel[] => KNOWN_MODELS.map((m) => ({ ...m, sources: ['built-in'] }));

export async function readCatalog(home: string): Promise<ModelCatalog> {
  return readJson<ModelCatalog>(join(home, 'cache', 'models.json'), { models: builtIn(), fetchedAt: null, problems: [] });
}

export async function refreshCatalog(home: string, s: Settings): Promise<ModelCatalog> {
  const models = builtIn();
  const problems: ModelCatalog['problems'] = [];
  try {
    for (const f of await discovery.foundationModels({ profile: s.bedrock.profile ?? '', region: s.bedrock.region })) {
      // anthropic.claude-x-v1:0 and its context-window variants (…:200k) are one model.
      const id = baseModel(f.id);
      const have = models.find((m) => m.id === id);
      if (have) { if (!have.sources.includes('bedrock')) have.sources.push('bedrock'); }
      else models.push({ id, label: f.name.replace(/^Claude\s+/, ''), sources: ['bedrock'] });
    }
  } catch (err: any) {
    problems.push({ source: 'bedrock', message: `Bedrock (${s.bedrock.profile || 'default profile'}, ${s.bedrock.region}): ${err?.message ?? err}` });
  }
  const catalog = { models, fetchedAt: new Date().toISOString(), problems };
  await writeJson(join(home, 'cache', 'models.json'), catalog);
  return catalog;
}
