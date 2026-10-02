import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestApp, put, type TestApp } from '../helpers/app.ts';
import { runCli, freePort } from '../helpers/cli.ts';

// A throwaway ~/.aws with no usable credentials: nothing here can reach AWS.
let aws: string;
let app: TestApp;
const saved = { ...process.env };
before(async () => {
  aws = await mkdtemp(join(tmpdir(), 'polly-aws-'));
  await writeFile(join(aws, 'config'), '[profile narration]\nregion = eu-west-1\n');
  await writeFile(join(aws, 'credentials'), '');
  Object.assign(process.env, { AWS_CONFIG_FILE: join(aws, 'config'), AWS_SHARED_CREDENTIALS_FILE: join(aws, 'credentials'), AWS_EC2_METADATA_DISABLED: 'true' });
  for (const k of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) delete process.env[k];
  app = await startTestApp();
});
after(async () => { await app.stop(); await rm(aws, { recursive: true, force: true }); process.env = saved; });

test('Polly has its own AWS profile and region, independent of Bedrock', async () => {
  const r = await app.json('/api/settings', put({ polly: { profile: 'narration', region: 'eu-west-1' } }));
  assert.deepEqual(r.settings.polly, { profile: 'narration', region: 'eu-west-1' });
  assert.equal(r.settings.bedrock.profile, undefined);
  assert.equal(r.settings.bedrock.region, 'us-east-1');
  for (const polly of [{ region: 'not a region' }, { region: 'us-east-1', profile: 'has spaces' }]) {
    assert.equal((await app.api('/api/settings', put({ polly }))).status, 400, JSON.stringify(polly));
  }
});

test('the Polly check tries a profile and region before saving, and says how to fix a failure', async () => {
  const r = await app.json('/api/tts/polly/check?profile=missing&region=us-west-2');
  assert.equal(r.ok, false);
  assert.match(r.detail, /region us-west-2, profile missing/);
  assert.match(r.fix, /aws sso login --profile missing/);
  assert.match(r.fix, /Settings > Voices/);
  assert.equal((await app.api('/api/tts/polly/check?profile=x&region=nowhere')).status, 400);
  assert.equal((await app.api('/api/tts/polly/check?profile=a%20b&region=us-east-1')).status, 400);
});

test('a changed Polly profile takes effect without a restart', async () => {
  await app.json('/api/settings', put({ polly: { profile: 'first', region: 'us-east-1' } }));
  const a = await app.api('/api/tts/polly/voices');
  assert.match((await a.json()).error, /profile first/);
  await app.json('/api/settings', put({ polly: { profile: 'second', region: 'us-east-1' } }));
  const b = await app.api('/api/tts/polly/voices');
  assert.match((await b.json()).error, /profile second/);
});

test('explainer setup takes separate Polly and Bedrock profiles; --aws-profile sets both', async () => {
  const home = await mkdtemp(join(tmpdir(), 'explainer-setup-'));
  const read = async () => JSON.parse(await readFile(join(home, 'settings.json'), 'utf8'));
  try {
    const env = { EXPLAINER_HOME: home };
    await runCli(['setup', '--yes', '--no-open', '--port', String(await freePort()), '--tts', 'fake', '--agent', 'fake', '--polly-profile', 'narration', '--polly-region', 'eu-west-1', '--bedrock-profile', 'models'], env);
    let s = await read();
    assert.deepEqual(s.polly, { region: 'eu-west-1', profile: 'narration' });
    assert.equal(s.bedrock.profile, 'models');
    await runCli(['setup', '--yes', '--no-open', '--aws-profile', 'both'], env);
    s = await read();
    assert.equal(s.polly.profile, 'both');
    assert.equal(s.bedrock.profile, 'both');
  } finally {
    await runCli(['stop'], { EXPLAINER_HOME: home });
    await rm(home, { recursive: true, force: true });
  }
});
