import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand, type InferenceProfileType } from '@aws-sdk/client-bedrock';
import { fromIni } from '@aws-sdk/credential-providers';
import type { Settings, BedrockScope } from '../../settings.ts';
import type { CheckDef } from '../../doctor.ts';
import { bedrockAuthFix, bedrockModel, awsCredentialsError } from './agent.ts';

/**
 * Discovery for the Bedrock agent surface: local AWS profiles (names and regions only,
 * never keys) and the inference profiles a profile can see in a region.
 */

export interface AwsProfile {
  name: string;
  region?: string;
  /** Signs in through IAM Identity Center (needs `aws sso login`). */
  sso: boolean;
  /** Which files define it. */
  sources: ('config' | 'credentials')[];
}

export interface InferenceProfile {
  id: string;
  arn: string;
  name: string;
  type: string;
  status?: string;
  /** An Anthropic Claude model; these sort first. */
  anthropic: boolean;
}

export interface BedrockQuery { profile?: string; region: string }

/** Minimal INI reader: section name -> key/value pairs. Comments and blank lines are skipped. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let cur: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (sec) { cur = out[sec[1]] ??= {}; continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && cur && !/^\s/.test(raw)) cur[kv[1].trim()] = kv[2].trim();
  }
  return out;
}

const read = (f: string) => readFile(f, 'utf8').catch(() => '');

/** Profiles from the shared config and credentials files (AWS_CONFIG_FILE / AWS_SHARED_CREDENTIALS_FILE honoured). */
export async function listAwsProfiles(env: NodeJS.ProcessEnv = process.env): Promise<AwsProfile[]> {
  const configFile = env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config');
  const credsFile = env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials');
  const byName = new Map<string, AwsProfile>();
  const get = (name: string) => byName.get(name) ?? byName.set(name, { name, sso: false, sources: [] }).get(name)!;

  for (const [section, kv] of Object.entries(parseIni(await read(configFile)))) {
    const name = section === 'default' ? 'default' : /^profile\s+(.+)$/.exec(section)?.[1]?.trim();
    if (!name) continue; // sso-session, services, ...
    const p = get(name);
    p.sources.push('config');
    if (kv.region) p.region = kv.region;
    if (kv.sso_session || kv.sso_start_url) p.sso = true;
  }
  // Only section names are read from the credentials file; keys never leave it.
  for (const section of Object.keys(parseIni(await read(credsFile)))) {
    const p = get(section.trim());
    if (!p.sources.includes('credentials')) p.sources.push('credentials');
  }
  return [...byName.values()].sort((a, b) => (a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name)));
}

/** Same credentials as the child gets: the named profile, else `default` (inherited AWS_* keys are not used). */
function client(q: BedrockQuery): BedrockClient {
  return new BedrockClient({ region: q.region, credentials: fromIni({ profile: q.profile || 'default' }) });
}

const isAnthropic = (id: string) => /(^|\.)anthropic\.claude/.test(id);

/** Lists system-defined and application inference profiles via the AWS SDK. */
async function sdkInferenceProfiles(q: BedrockQuery): Promise<InferenceProfile[]> {
  const c = client(q);
  const out: InferenceProfile[] = [];
  for (const type of ['SYSTEM_DEFINED', 'APPLICATION'] as InferenceProfileType[]) {
    let nextToken: string | undefined;
    try {
      do {
        const r = await c.send(new ListInferenceProfilesCommand({ typeEquals: type, maxResults: 1000, nextToken }), { abortSignal: AbortSignal.timeout(20_000) });
        for (const p of r.inferenceProfileSummaries ?? []) {
          const id = p.inferenceProfileId ?? '';
          // Application profiles carry the backing model only in their model ARNs.
          const anthropic = isAnthropic(id) || (p.models ?? []).some((m) => isAnthropic(m.modelArn ?? ''));
          out.push({ id: type === 'APPLICATION' ? p.inferenceProfileArn ?? id : id, arn: p.inferenceProfileArn ?? '', name: p.inferenceProfileName ?? id, type: String(p.type ?? type), status: p.status, anthropic });
        }
        nextToken = r.nextToken;
      } while (nextToken);
    } catch (err) {
      if (type === 'SYSTEM_DEFINED') throw err; // application profiles are optional (and often not permitted)
    }
  }
  return out;
}

/** `inferenceTypesSupported` includes ON_DEMAND when the bare id can be called in the region. */
export interface FoundationModel { id: string; name: string; inferenceTypesSupported: string[] }

/** Active Anthropic foundation models in the region. */
async function sdkFoundationModels(q: BedrockQuery): Promise<FoundationModel[]> {
  const r = await client(q).send(new ListFoundationModelsCommand({ byProvider: 'Anthropic' }), { abortSignal: AbortSignal.timeout(20_000) });
  return (r.modelSummaries ?? []).filter((m) => m.modelLifecycle?.status !== 'LEGACY' && m.modelId)
    .map((m) => ({ id: m.modelId!, name: m.modelName ?? m.modelId!, inferenceTypesSupported: m.inferenceTypesSupported ?? [] }));
}

/** Swappable for tests: the functions that ask Bedrock. */
export const discovery = { inferenceProfiles: sdkInferenceProfiles, foundationModels: sdkFoundationModels };

/** Inference profiles for a profile/region, Anthropic Claude first. */
export async function listInferenceProfiles(q: BedrockQuery): Promise<InferenceProfile[]> {
  const all = await discovery.inferenceProfiles(q);
  return all.sort((a, b) => Number(b.anthropic) - Number(a.anthropic) || a.id.localeCompare(b.id));
}

/** True when an AWS error means the credentials are missing or expired. */
export function isCredentialsError(err: any): boolean {
  return /Credential|Token|Expired|Unrecognized|SSO|InvalidSignature|InvalidClientTokenId/i.test(`${err?.name ?? ''} ${err?.message ?? ''}`);
}

/** `us.anthropic.claude-haiku-4-5-20251001-v1:0` -> `claude-haiku-4-5`; context-window variants (`…:200k`) are the same model. */
export const baseModel = (id: string) => id.replace(/:\d+k$/, '').replace(/^([a-z-]+\.)?anthropic\./, '').replace(/-v\d+(:\d+)?$/, '').replace(/-\d{8}$/, '');

export interface Suggestion { id: string; scope: BedrockScope; fellBack: boolean }

/** Scopes tried for each routing scope, in order: falling back to a stricter one is safe; to global never is. */
const FALLBACK: Record<BedrockScope, BedrockScope[]> = { global: ['global', 'geo', 'in-region'], geo: ['geo', 'in-region'], 'in-region': ['in-region'] };

/**
 * Suggested Bedrock id per app model id: the same model (ignoring date/version suffixes) in the
 * routing scope, else the next stricter scope (`fellBack`). A system-defined profile is global
 * by its `global.` prefix and geo by any other (`us.`, `jp.`, ...); in-region is the bare
 * foundation model id, when it runs on demand. Models with no match are left out.
 */
export function suggestMapping(modelIds: string[], profiles: InferenceProfile[], region: string, scope: BedrockScope, foundationModels: FoundationModel[] = []): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  for (const m of modelIds) {
    const hits = profiles.filter((p) => p.type === 'SYSTEM_DEFINED' && p.anthropic && baseModel(p.id) === baseModel(m));
    const candidates: Record<BedrockScope, string | undefined> = {
      global: hits.find((p) => p.id.startsWith('global.'))?.id,
      geo: hits.find((p) => !p.id.startsWith('global.') && /^[a-z-]+\.anthropic\./.test(p.id))?.id,
      'in-region': foundationModels.find((f) => baseModel(f.id) === baseModel(m) && f.inferenceTypesSupported.includes('ON_DEMAND'))?.id,
    };
    const got = FALLBACK[scope].find((sc) => candidates[sc]);
    if (got) out[m] = { id: candidates[got]!, scope: got, fellBack: got !== scope };
  }
  return out;
}

/** Doctor checks for the Bedrock surface, beyond the CLI check: credentials resolve and the default model is mapped. */
export const BEDROCK_CHECKS: CheckDef[] = [
  {
    id: 'claude-bedrock-credentials', label: 'AWS credentials for Bedrock',
    async run(s: Settings) {
      const where = `profile ${s.bedrock.profile || 'default'}, region ${s.bedrock.region}`;
      const err = await awsCredentialsError(s.bedrock.profile);
      return err ? { ok: false, detail: `${where}: ${err}`, fix: bedrockAuthFix(s.bedrock) } : { ok: true, detail: where };
    },
  },
  {
    id: 'claude-bedrock-model', label: 'Bedrock model mapping',
    async run(s: Settings) {
      const m = bedrockModel(s.bedrock, s.defaults.model);
      return typeof m === 'string'
        ? { ok: true, detail: `${s.defaults.model} -> ${m}` }
        : { ok: false, detail: `default model ${s.defaults.model} is not mapped`, fix: 'open Settings > Models & agents > Amazon Bedrock, press Discover and save the mapping' };
    },
  },
];
