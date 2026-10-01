import { chmod } from 'node:fs/promises';
import { readJson, writeJson, type Paths } from './datadir.ts';

/**
 * Provider API keys, kept apart from settings.json in <home>/secrets.json with user-only
 * permissions (0600, re-applied on every write). Values never leave this module except to the
 * provider that needs them: routes and the UI only ever see secretStatus().
 *
 * Shape on disk: { "<provider id>": { "<key name>": "<value>" } }.
 */
type SecretsFile = Record<string, Record<string, string>>;

export const SECRETS_MODE = 0o600;

/** Serializes writes so concurrent PUTs can't lose each other's keys. */
let writing: Promise<unknown> = Promise.resolve();

async function load(p: Paths): Promise<SecretsFile> {
  const s = await readJson<SecretsFile>(p.secrets, {});
  return s && typeof s === 'object' ? s : {};
}

export async function getSecret(p: Paths, provider: string, key: string): Promise<string | undefined> {
  const v = (await load(p))[provider]?.[key];
  return typeof v === 'string' && v ? v : undefined;
}

/** Sets a secret. An empty value deletes it. */
export function setSecret(p: Paths, provider: string, key: string, value: string): Promise<void> {
  const run = async () => {
    const s = await load(p);
    if (value) (s[provider] ??= {})[key] = value;
    else if (s[provider]) {
      delete s[provider][key];
      if (!Object.keys(s[provider]).length) delete s[provider];
    }
    await writeJson(p.secrets, s, SECRETS_MODE);
    await chmod(p.secrets, SECRETS_MODE);
  };
  const next = writing.then(run, run);
  writing = next.catch(() => {});
  return next;
}

/** Which keys are set, per provider: { elevenlabs: { apiKey: 'set' } }. Never the values. */
export async function secretStatus(p: Paths): Promise<Record<string, Record<string, 'set'>>> {
  const out: Record<string, Record<string, 'set'>> = {};
  for (const [provider, keys] of Object.entries(await load(p))) {
    for (const [k, v] of Object.entries(keys ?? {})) if (typeof v === 'string' && v) (out[provider] ??= {})[k] = 'set';
  }
  return out;
}
