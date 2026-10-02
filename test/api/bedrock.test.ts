import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, waitForJob, post, put, type TestApp } from '../helpers/app.ts';
import { discovery, parseIni, suggestMapping, BEDROCK_CHECKS, type InferenceProfile } from '../../src/providers/claude/bedrock.ts';
import { createClaudeSurface, bedrockSurfaceConfig, bedrockModel, childEnv, SUBSCRIPTION } from '../../src/providers/claude/agent.ts';
import { providerChecks } from '../../src/providers/registry.ts';
import { DEFAULT_SETTINGS, merge } from '../../src/settings.ts';

// A fake ~/.aws: discovery and the credentials preflight read these instead of the real files.
const SECRET = 'wJalrFAKEFAKEFAKEsecretKEY';
before(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-aws-'));
  await writeFile(join(dir, 'config'), `# comment
[default]
region = us-west-2

[profile sandbox]
sso_session = corp
sso_account_id = 000000000000
sso_role_name = Dev
region = eu-west-1

[sso-session corp]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1

[profile keys-only]
output = json
`);
  await writeFile(join(dir, 'credentials'), `[default]
aws_access_key_id = AKIAFAKEFAKEFAKE
aws_secret_access_key = ${SECRET}

[ci]
aws_access_key_id = AKIAFAKEFAKEFAKE2
aws_secret_access_key = ${SECRET}
`);
  process.env.AWS_CONFIG_FILE = join(dir, 'config');
  process.env.AWS_SHARED_CREDENTIALS_FILE = join(dir, 'credentials');
});

const PROFILES: InferenceProfile[] = [
  { id: 'us.amazon.nova-pro-v1:0', arn: 'arn:x', name: 'Nova Pro', type: 'SYSTEM_DEFINED', anthropic: false },
  { id: 'global.anthropic.claude-opus-5-5', arn: 'arn:x', name: 'Opus 5.5 global', type: 'SYSTEM_DEFINED', anthropic: true },
  { id: 'us.anthropic.claude-opus-5-5', arn: 'arn:x', name: 'Opus 5.5 US', type: 'SYSTEM_DEFINED', anthropic: true },
  { id: 'eu.anthropic.claude-fable-5-1', arn: 'arn:x', name: 'Fable 5.1 EU', type: 'SYSTEM_DEFINED', anthropic: true },
  { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', arn: 'arn:x', name: 'Haiku 4.5', type: 'SYSTEM_DEFINED', anthropic: true },
  { id: 'us.anthropic.claude-opus-5', arn: 'arn:x', name: 'Opus 5', type: 'SYSTEM_DEFINED', anthropic: true },
];

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('ini parsing keeps sections and keys, skips comments', () => {
  const ini = parseIni('# x\n[profile a]\nregion = us-east-1\n; y\n[b]\nk=v=w\n');
  assert.deepEqual(ini, { 'profile a': { region: 'us-east-1' }, b: { k: 'v=w' } });
});

test('profiles come from ~/.aws/config and ~/.aws/credentials, with names and regions but never keys', async () => {
  const res = await app.api('/api/bedrock/profiles');
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(SECRET) && !text.includes('AKIA'), 'credentials leaked');
  const { profiles, selected } = JSON.parse(text);
  assert.equal(selected, '');
  assert.deepEqual(profiles.map((p: any) => p.name), ['default', 'ci', 'keys-only', 'sandbox']);
  const by = Object.fromEntries(profiles.map((p: any) => [p.name, p]));
  assert.deepEqual(by.default, { name: 'default', region: 'us-west-2', sso: false, sources: ['config', 'credentials'] });
  assert.deepEqual(by.sandbox, { name: 'sandbox', region: 'eu-west-1', sso: true, sources: ['config'] });
  assert.deepEqual(by.ci.sources, ['credentials']);
});

test('inference profiles list Anthropic first and suggest a mapping for the model list in the routing scope', async (t) => {
  const seen: any[] = [];
  const orig = { ...discovery };
  discovery.inferenceProfiles = async (q) => { seen.push(q); return PROFILES.map((p) => ({ ...p })); };
  // Every model maps to a profile here, so foundation models are not listed.
  let listed = 0;
  discovery.foundationModels = async () => { listed++; return []; };
  t.after(() => { Object.assign(discovery, orig); });

  const r = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=us-east-1');
  assert.deepEqual(seen, [{ profile: 'sandbox', region: 'us-east-1' }]);
  assert.equal(r.inferenceProfiles.at(-1).id, 'us.amazon.nova-pro-v1:0');
  assert.ok(r.inferenceProfiles.slice(0, -1).every((p: any) => p.anthropic));
  // Global (the default) wins; Fable has only an EU profile, so it falls back to that.
  assert.equal(r.scope, 'global');
  assert.deepEqual(r.suggested, {
    'claude-opus-5-5': { id: 'global.anthropic.claude-opus-5-5', scope: 'global', fellBack: false },
    'claude-fable-5-1': { id: 'eu.anthropic.claude-fable-5-1', scope: 'geo', fellBack: true },
  });

  // ?scope= overrides the saved scope (Discover sends the unsaved choice).
  const g = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=us-east-1&scope=geo');
  assert.equal(g.scope, 'geo');
  assert.deepEqual(g.suggested['claude-opus-5-5'], { id: 'us.anthropic.claude-opus-5-5', scope: 'geo', fellBack: false });

  // Defaults come from settings.
  await app.json('/api/settings', put({ bedrock: { profile: 'ci', region: 'eu-west-1', scope: 'geo' } }));
  const d = await app.json('/api/bedrock/inference-profiles');
  assert.equal(d.profile, 'ci');
  assert.equal(d.region, 'eu-west-1');
  assert.equal(d.scope, 'geo');
  assert.deepEqual(d.suggested['claude-opus-5-5'], { id: 'us.anthropic.claude-opus-5-5', scope: 'geo', fellBack: false });
  await app.json('/api/settings', put({ bedrock: { scope: 'global' } }));
  assert.equal(listed, 0);

  assert.equal((await app.api('/api/bedrock/inference-profiles?region=not%20a%20region')).status, 400);
  const bad = await app.api('/api/bedrock/inference-profiles?scope=apac');
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /not a routing scope: "apac"/);
});

test('in-region discovery lists foundation models and maps only those that run on demand; a failure there maps nothing', async (t) => {
  const orig = { ...discovery };
  const asked: any[] = [];
  discovery.inferenceProfiles = async () => PROFILES.map((p) => ({ ...p }));
  discovery.foundationModels = async (q) => {
    asked.push(q);
    return [
      { id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', inferenceTypesSupported: ['ON_DEMAND'] },
      { id: 'anthropic.claude-fable-5-1', name: 'Claude Fable 5.1', inferenceTypesSupported: ['INFERENCE_PROFILE'] },
    ];
  };
  t.after(() => { Object.assign(discovery, orig); });

  const r = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region');
  assert.deepEqual(asked, [{ profile: 'sandbox', region: 'eu-west-2' }]);
  assert.equal(r.scope, 'in-region');
  assert.deepEqual(r.suggested, { 'claude-opus-5-5': { id: 'anthropic.claude-opus-5-5', scope: 'in-region', fellBack: false } });

  discovery.foundationModels = async () => { throw new Error('AccessDenied: bedrock:ListFoundationModels'); };
  const f = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region');
  assert.deepEqual(f.suggested, {});
  assert.equal(f.inferenceProfiles.length, PROFILES.length);
});

test('discovery returns problems: [] when none, and a foundation-models failure as a problem', async (t) => {
  const orig = { ...discovery };
  discovery.inferenceProfiles = async () => PROFILES.map((p) => ({ ...p }));
  discovery.foundationModels = async () => [{ id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', inferenceTypesSupported: ['ON_DEMAND'] }];
  t.after(() => { Object.assign(discovery, orig); });

  const ok = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region');
  assert.deepEqual(ok.problems, []);

  discovery.foundationModels = async () => { throw new Error('AccessDenied: bedrock:ListFoundationModels'); };
  const f = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region');
  assert.equal(f.problems.length, 1);
  assert.equal(f.problems[0].source, 'foundation-models');
  assert.match(f.problems[0].message, /AccessDenied: bedrock:ListFoundationModels/);
});

test('in-region discovery survives a non-credential inference-profiles failure; global and geo still fail with 502', async (t) => {
  const orig = { ...discovery };
  discovery.inferenceProfiles = async () => { throw new Error('AccessDenied: bedrock:ListInferenceProfiles'); };
  discovery.foundationModels = async () => [{ id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', inferenceTypesSupported: ['ON_DEMAND'] }];
  t.after(() => { Object.assign(discovery, orig); });

  const r = await app.json('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region');
  assert.deepEqual(r.inferenceProfiles, []);
  assert.deepEqual(r.suggested, { 'claude-opus-5-5': { id: 'anthropic.claude-opus-5-5', scope: 'in-region', fellBack: false } });
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].source, 'inference-profiles');
  assert.match(r.problems[0].message, /AccessDenied: bedrock:ListInferenceProfiles/);

  for (const scope of ['global', 'geo']) {
    assert.equal((await app.api(`/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=${scope}`)).status, 502, scope);
  }
  // Credential errors stay 401, in-region too.
  discovery.inferenceProfiles = async () => { throw Object.assign(new Error('The SSO session associated with this profile has expired'), { name: 'CredentialsProviderError' }); };
  assert.equal((await app.api('/api/bedrock/inference-profiles?profile=sandbox&region=eu-west-2&scope=in-region')).status, 401);
});

test('when global or geo falls back to in-region, the route also lists foundation models', async (t) => {
  const orig = { ...discovery };
  let listed = 0;
  // No profile for Fable; it runs on demand in the region.
  discovery.inferenceProfiles = async () => PROFILES.filter((p) => !p.id.includes('fable')).map((p) => ({ ...p }));
  discovery.foundationModels = async () => { listed++; return [{ id: 'anthropic.claude-fable-5-1', name: 'Claude Fable 5.1', inferenceTypesSupported: ['ON_DEMAND'] }]; };
  t.after(() => { Object.assign(discovery, orig); });

  for (const scope of ['global', 'geo']) {
    const r = await app.json(`/api/bedrock/inference-profiles?profile=sandbox&region=us-east-1&scope=${scope}`);
    assert.deepEqual(r.suggested['claude-fable-5-1'], { id: 'anthropic.claude-fable-5-1', scope: 'in-region', fellBack: true }, scope);
  }
  assert.equal(listed, 2);
});

test('suggestions ignore date/version suffixes and do not confuse model generations', () => {
  const s = suggestMapping(['claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-9'], PROFILES, 'us-east-1', 'geo');
  assert.deepEqual(s, {
    'claude-haiku-4-5': { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', scope: 'geo', fellBack: false },
    'claude-opus-5': { id: 'us.anthropic.claude-opus-5', scope: 'geo', fellBack: false },
  });
});

// Foundation models in the region: only Haiku 4.5 and Opus 5 can be called on demand without a profile.
const FOUNDATION = [
  { id: 'anthropic.claude-opus-5-5', name: 'Claude Opus 5.5', inferenceTypesSupported: ['INFERENCE_PROFILE'] },
  { id: 'anthropic.claude-haiku-4-5-20251001-v1:0', name: 'Claude Haiku 4.5', inferenceTypesSupported: ['ON_DEMAND', 'INFERENCE_PROFILE'] },
  { id: 'anthropic.claude-opus-5', name: 'Claude Opus 5', inferenceTypesSupported: ['ON_DEMAND'] },
];
const MODELS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-haiku-4-5', 'claude-opus-5'];

test('global scope: global profile first, else the geo profile, else the bare in-region id; each fallback is flagged', () => {
  assert.deepEqual(suggestMapping(MODELS, PROFILES, 'us-east-1', 'global', FOUNDATION), {
    'claude-opus-5-5': { id: 'global.anthropic.claude-opus-5-5', scope: 'global', fellBack: false },
    'claude-fable-5-1': { id: 'eu.anthropic.claude-fable-5-1', scope: 'geo', fellBack: true },
    'claude-haiku-4-5': { id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', scope: 'geo', fellBack: true },
    'claude-opus-5': { id: 'us.anthropic.claude-opus-5', scope: 'geo', fellBack: true },
  });
  const only = [{ id: 'anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5', inferenceTypesSupported: ['ON_DEMAND'] }];
  assert.deepEqual(suggestMapping(['claude-sonnet-5-5'], [], 'eu-west-2', 'global', only),
    { 'claude-sonnet-5-5': { id: 'anthropic.claude-sonnet-5-5', scope: 'in-region', fellBack: true } });
});

test('geo scope: the region\'s geo profile (jp. in Tokyo), else in-region; never a global profile', () => {
  const tokyo: InferenceProfile[] = [
    { id: 'global.anthropic.claude-opus-5-5', arn: 'arn:x', name: 'Opus 5.5 global', type: 'SYSTEM_DEFINED', anthropic: true },
    { id: 'jp.anthropic.claude-opus-5-5', arn: 'arn:x', name: 'Opus 5.5 JP', type: 'SYSTEM_DEFINED', anthropic: true },
    { id: 'global.anthropic.claude-sonnet-5-5', arn: 'arn:x', name: 'Sonnet 5.5 global', type: 'SYSTEM_DEFINED', anthropic: true },
  ];
  assert.deepEqual(suggestMapping(['claude-opus-5-5', 'claude-sonnet-5-5'], tokyo, 'ap-northeast-1', 'geo'),
    { 'claude-opus-5-5': { id: 'jp.anthropic.claude-opus-5-5', scope: 'geo', fellBack: false } });
  assert.deepEqual(suggestMapping(['claude-opus-5', 'claude-haiku-4-5'], PROFILES.filter((p) => !p.id.startsWith('us.')), 'us-east-1', 'geo', FOUNDATION), {
    'claude-opus-5': { id: 'anthropic.claude-opus-5', scope: 'in-region', fellBack: true },
    'claude-haiku-4-5': { id: 'anthropic.claude-haiku-4-5-20251001-v1:0', scope: 'in-region', fellBack: true },
  });
});

test('in-region scope: only bare foundation model ids that run on demand; application profiles are never suggested', () => {
  const app: InferenceProfile = { id: 'arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/abc', arn: 'arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/abc', name: 'claude-opus-5-5', type: 'APPLICATION', anthropic: true };
  assert.deepEqual(suggestMapping(MODELS, [...PROFILES, app], 'us-east-1', 'in-region', FOUNDATION), {
    'claude-haiku-4-5': { id: 'anthropic.claude-haiku-4-5-20251001-v1:0', scope: 'in-region', fellBack: false },
    'claude-opus-5': { id: 'anthropic.claude-opus-5', scope: 'in-region', fellBack: false },
  });
  assert.deepEqual(suggestMapping(MODELS, PROFILES, 'us-east-1', 'in-region'), {});
});

test('in-region scope: a context-window variant (:200k) of a foundation model matches its model', () => {
  const fm = [{ id: 'anthropic.claude-mythos-6-v1:0:200k', name: 'Claude Mythos 6', inferenceTypesSupported: ['ON_DEMAND'] }];
  assert.deepEqual(suggestMapping(['claude-mythos-6'], [], 'us-east-1', 'in-region', fm),
    { 'claude-mythos-6': { id: 'anthropic.claude-mythos-6-v1:0:200k', scope: 'in-region', fellBack: false } });
});

test('application profiles are never suggested in global or geo scope, even when their id would match', () => {
  const appProfile = (id: string): InferenceProfile => ({ id, arn: 'arn:x', name: id, type: 'APPLICATION', anthropic: true });
  assert.deepEqual(suggestMapping(['claude-opus-5-5'], [appProfile('global.anthropic.claude-opus-5-5')], 'us-east-1', 'global'), {});
  assert.deepEqual(suggestMapping(['claude-sonnet-5-5'], [appProfile('us.anthropic.claude-sonnet-5-5')], 'us-east-1', 'geo'), {});
  // With an in-region option, it falls back past the application profile.
  const fm = [{ id: 'anthropic.claude-sonnet-5-5', name: 'Claude Sonnet 5.5', inferenceTypesSupported: ['ON_DEMAND'] }];
  assert.deepEqual(suggestMapping(['claude-sonnet-5-5'], [appProfile('global.anthropic.claude-sonnet-5-5'), appProfile('us.anthropic.claude-sonnet-5-5')], 'us-east-1', 'global', fm),
    { 'claude-sonnet-5-5': { id: 'anthropic.claude-sonnet-5-5', scope: 'in-region', fellBack: true } });
});

test('expired or missing credentials during discovery say how to sign in', async (t) => {
  const orig = discovery.inferenceProfiles;
  discovery.inferenceProfiles = async () => { throw Object.assign(new Error('The SSO session associated with this profile has expired'), { name: 'CredentialsProviderError' }); };
  t.after(() => { discovery.inferenceProfiles = orig; });
  const res = await app.api('/api/bedrock/inference-profiles?profile=sandbox&region=us-east-1');
  assert.equal(res.status, 401);
  assert.match((await res.json()).error, /aws sso login --profile sandbox/);
});

test('the model list can be edited; the default must stay in it and the effort must exist', async () => {
  const models = [{ id: 'claude-fable-5-1', label: 'Fable 5.1' }, { id: 'claude-opus-5-5', label: 'Opus 5.5' }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5' }];
  let s = (await app.json('/api/settings', put({ models }))).settings;
  assert.deepEqual(s.models, models);
  s = (await app.json('/api/settings', put({ defaults: { model: 'claude-haiku-4-5', effort: 'low' } }))).settings;
  assert.deepEqual(s.defaults, { model: 'claude-haiku-4-5', effort: 'low' });

  const bad = async (body: unknown, re: RegExp) => {
    const res = await app.api('/api/settings', put(body));
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match((await res.json()).error, re);
  };
  await bad({ models: models.filter((m) => m.id !== 'claude-haiku-4-5') }, /default model "claude-haiku-4-5" is not in the model list/);
  await bad({ models: [...models, models[0]] }, /listed twice/);
  await bad({ models: [] }, /cannot be empty/);
  await bad({ models: [{ id: '', label: 'x' }] }, /id and a label/);
  await bad({ defaults: { effort: 'ludicrous' } }, /default effort/);
  await bad({ bedrock: { models: { 'claude-opus-5-5': 42 } } }, /inference profile ids/);
  assert.deepEqual((await app.json('/api/settings')).settings.defaults, { model: 'claude-haiku-4-5', effort: 'low' });

  s = (await app.json('/api/settings', put({ models: DEFAULT_SETTINGS.models, defaults: DEFAULT_SETTINGS.defaults }))).settings;
  assert.equal(s.defaults.model, 'claude-opus-5-5');
});

test('bedrock routing scope defaults to global, accepts geo and in-region, and rejects anything else', async () => {
  assert.equal(merge(DEFAULT_SETTINGS, { bedrock: { region: 'eu-west-1', models: {} } }).bedrock.scope, 'global');
  assert.equal((await app.json('/api/settings')).settings.bedrock.scope, 'global');
  assert.equal((await app.json('/api/settings', put({ bedrock: { scope: 'geo' } }))).settings.bedrock.scope, 'geo');
  assert.equal((await app.json('/api/settings', put({ bedrock: { scope: 'in-region' } }))).settings.bedrock.scope, 'in-region');
  const res = await app.api('/api/settings', put({ bedrock: { scope: 'apac' } }));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /bedrock\.scope must be global, geo or in-region, not "apac"/);
  assert.equal((await app.json('/api/settings')).settings.bedrock.scope, 'in-region');
  await app.json('/api/settings', put({ bedrock: { scope: 'global' } }));
});

test('the agent surface is chosen per explainer, defaulting to settings, and validated', async () => {
  const { available } = await app.json('/api/settings');
  assert.ok(available.agent.some((a: any) => a.id === 'claude-bedrock'));

  await app.json('/api/settings', put({ providers: { agent: 'claude-subscription' } }));
  const e = await app.json('/api/explainers', post({ brief: 'sensitive thing' }));
  assert.equal(e.surface, 'claude-subscription');
  await app.json('/api/settings', put({ providers: { agent: 'fake' } }));

  const u = await app.json(`/api/explainers/${e.id}`, put({ surface: 'claude-bedrock' }));
  assert.equal(u.surface, 'claude-bedrock');
  assert.equal((await app.json(`/api/explainers/${e.id}`)).surface, 'claude-bedrock');
  const res = await app.api(`/api/explainers/${e.id}`, put({ surface: 'carrier-pigeon' }));
  assert.equal(res.status, 400);
  assert.equal((await app.json(`/api/explainers/${e.id}`)).surface, 'claude-bedrock');
});

test('a job on Bedrock with an unmapped model fails with a typed, clear message', async () => {
  await app.json('/api/settings', put({ bedrock: { profile: '', region: 'us-east-1', models: { 'claude-opus-5-5': '' } } }));
  const e = await app.json('/api/explainers', post({ brief: 'queues', surface: 'claude-bedrock', model: 'claude-opus-5-5' }));
  const job = await waitForJob(app, (await app.json(`/api/explainers/${e.id}/report`, post({}))).id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /claude-opus-5-5.*no Bedrock inference profile mapped/);
});

test('bedrock surface: unmapped model is "unavailable"; ids that already are Bedrock ids pass through', async () => {
  const s = createClaudeSurface({ ...bedrockSurfaceConfig(() => ({ profile: 'sandbox', region: 'us-east-1', models: {} })), bin: 'no-such-claude-binary' });
  const dir = await mkdtemp(join(tmpdir(), 'bedrock-'));
  const r = await s.run({ kind: 'probe', prompt: 'x', inputs: {} }, { workdir: dir, model: 'claude-opus-5-5', effort: 'low' });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.error.kind, 'unavailable'); assert.match(r.error.message, /Settings > Models & agents > Amazon Bedrock/); }
  const b = { region: 'us-east-1', models: { 'claude-opus-5-5': 'us.anthropic.claude-opus-5-5', 'claude-fable-5-1': ' ' } };
  assert.equal(bedrockModel(b, 'claude-opus-5-5'), 'us.anthropic.claude-opus-5-5');
  assert.equal(bedrockModel(b, 'global.anthropic.claude-sonnet-5'), 'global.anthropic.claude-sonnet-5');
  assert.equal(bedrockModel(b, 'arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/abc'), 'arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/abc');
  assert.equal(typeof bedrockModel(b, 'claude-fable-5-1'), 'object');
});

test('bedrock surface: a profile without usable credentials is an auth failure naming the sign-in command', async () => {
  const s = createClaudeSurface({ ...bedrockSurfaceConfig(() => ({ profile: 'not-configured', region: 'us-east-1', models: { m: 'us.anthropic.claude-opus-5-5' } })), bin: 'no-such-claude-binary' });
  const r = await s.run({ kind: 'probe', prompt: 'x', inputs: {} }, { workdir: await mkdtemp(join(tmpdir(), 'bedrock-')), model: 'm', effort: 'low' });
  assert.equal(r.ok, false);
  if (!r.ok) { assert.equal(r.error.kind, 'auth'); assert.match(r.error.message, /aws sso login --profile not-configured/); }
});

test('bedrock child env: Bedrock on with the chosen profile/region; API keys and inherited AWS credentials dropped', () => {
  const base = { PATH: '/bin', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_PROFILE: 'other',
    AWS_REGION: 'ap-south-1', AWS_CONFIG_FILE: '/x/config', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_SESSION_ID: 'z' };
  const env = childEnv(bedrockSurfaceConfig(() => ({ profile: 'sandbox', region: 'eu-west-1', models: {} })), base);
  assert.deepEqual(env, { PATH: '/bin', AWS_CONFIG_FILE: '/x/config', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'eu-west-1', AWS_PROFILE: 'sandbox',
    ANTHROPIC_BEDROCK_REGION_PREFIX: 'global' });
  const noProfile = childEnv(bedrockSurfaceConfig(() => ({ region: 'us-east-1', models: {} })), base);
  assert.equal(noProfile.AWS_PROFILE, undefined);
  // The subscription variant is unchanged: no AWS at all.
  const sub = childEnv(SUBSCRIPTION, base);
  assert.ok(!Object.keys(sub).some((k) => k.startsWith('AWS_') || k.startsWith('ANTHROPIC_')));
  assert.equal(sub.CLAUDE_CODE_OAUTH_TOKEN, 't');
});

test('bedrock child env: ANTHROPIC_BEDROCK_REGION_PREFIX follows the routing scope and region; an inherited one never leaks in', () => {
  const prefix = (scope: 'global' | 'geo' | 'in-region', region: string) =>
    childEnv(bedrockSurfaceConfig(() => ({ region, scope, models: {} })), { ANTHROPIC_BEDROCK_REGION_PREFIX: 'apac' }).ANTHROPIC_BEDROCK_REGION_PREFIX;
  assert.equal(prefix('global', 'us-east-1'), 'global');
  assert.equal(prefix('global', 'ap-southeast-7'), 'global');
  assert.equal(prefix('global', 'us-gov-west-1'), undefined);
  const geo: [string, string | undefined][] = [['us-east-1', 'us'], ['us-west-1', 'us'], ['ca-west-1', 'us'], ['eu-west-2', 'eu'], ['eu-south-2', 'eu'],
    ['ap-northeast-1', 'jp'], ['ap-northeast-3', 'jp'], ['ap-southeast-2', 'au'], ['ap-southeast-4', 'au'],
    ['ap-northeast-2', undefined], ['ap-south-1', undefined], ['sa-east-1', undefined], ['me-central-1', undefined], ['us-gov-east-1', undefined]];
  for (const [region, want] of geo) assert.equal(prefix('geo', region), want, region);
  assert.equal(prefix('in-region', 'us-east-1'), undefined);
  assert.equal(prefix('in-region', 'eu-west-2'), undefined);
  // The explicit model id still routes.
  const c = bedrockSurfaceConfig(() => ({ region: 'us-east-1', scope: 'geo', models: { 'claude-opus-5-5': 'global.anthropic.claude-opus-5-5' } }));
  assert.equal(c.model!('claude-opus-5-5'), 'global.anthropic.claude-opus-5-5');
});

const NO_PATHS = {} as import('../../src/datadir.ts').Paths;

test('doctor: Bedrock checks only when it is the agent surface; the mapping check needs the default model mapped', async () => {
  const fake = merge(DEFAULT_SETTINGS, { providers: { agent: 'fake', tts: 'fake' } });
  const bed = merge(DEFAULT_SETTINGS, { providers: { agent: 'claude-bedrock' }, bedrock: { profile: 'sandbox' } });
  assert.ok(!providerChecks(fake).some((c) => c.id.startsWith('claude-bedrock')));
  assert.deepEqual(providerChecks(bed).map((c) => c.id).filter((id) => id.startsWith('claude-bedrock')), ['claude-bedrock-cli', 'claude-bedrock-credentials', 'claude-bedrock-model']);
  const mapping = BEDROCK_CHECKS.find((c) => c.id === 'claude-bedrock-model')!;
  assert.equal((await mapping.run(bed, NO_PATHS)).ok, false);
  assert.equal((await mapping.run(merge(bed, { bedrock: { models: { 'claude-opus-5-5': 'us.anthropic.claude-opus-5-5' } } }), NO_PATHS)).ok, true);
  const creds = await BEDROCK_CHECKS.find((c) => c.id === 'claude-bedrock-credentials')!.run(merge(bed, { bedrock: { profile: 'not-configured' } }), NO_PATHS);
  assert.equal(creds.ok, false);
  assert.match(creds.fix!, /aws sso login --profile not-configured/);
});
