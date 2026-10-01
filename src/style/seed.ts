import { readFile } from 'node:fs/promises';
import type { Paths } from '../datadir.ts';
import { saveSettings, type Settings } from '../settings.ts';
import type { StyleStore } from './store.ts';
import type { Providers } from '../providers/registry.ts';

const SEED_DIR = new URL('../../seed/styles/', import.meta.url);

/** Seed styles shipped with the app: authored in the repo, copied into the data dir on first run. */
const SEEDS = [{
  dir: 'hitchhikers-guide',
  name: "Hitchhiker's Guide",
  description: "Hitchhiker's Guide animations, very smooth transitions, camera movement, highlights of what's appearing, neon blue/green, high contrast, lively, room for humor.",
  /** Preferred voice per provider; other providers get their first voice. */
  voices: { polly: { voiceId: 'Brian:generative', controls: { rate: 100 } } } as Record<string, { voiceId: string; controls: Record<string, number> }>,
}];

/** Runs once per data dir (settings.seeded), so a deleted seed style stays deleted. */
export async function seedStyles(p: Paths, settings: Settings, styles: StyleStore, providers: Providers): Promise<Settings> {
  if (settings.seeded) return settings;
  for (const seed of SEEDS) {
    const provider = settings.providers.tts;
    let voice = seed.voices[provider];
    if (!voice) {
      const first = await providers.tts(provider).voices().then((v) => v[0]).catch(() => undefined);
      voice = { voiceId: first?.id ?? '', controls: {} };
    }
    const design = await readFile(new URL(`${seed.dir}/DESIGN.md`, SEED_DIR), 'utf8');
    await styles.create({
      name: seed.name, description: seed.description, design,
      voice: { provider, voiceId: voice.voiceId, controls: voice.controls },
      model: settings.defaults.model, effort: settings.defaults.effort,
    });
  }
  return saveSettings(p, { seeded: true });
}
