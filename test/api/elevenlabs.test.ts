import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElevenLabsTts, wordsFromAlignment, elevenLabsChecks, ELEVENLABS_CAPABILITIES } from '../../src/providers/elevenlabs/tts.ts';
import { providerChecks } from '../../src/providers/registry.ts';
import { DEFAULT_SETTINGS, merge } from '../../src/settings.ts';
import { ensureDataDir } from '../../src/datadir.ts';
import { setSecret } from '../../src/secrets.ts';
import { ttsContract } from '../contracts/tts.ts';
import { startElevenLabsMock } from '../helpers/elevenlabs-mock.ts';
import { startTestApp, post, put } from '../helpers/app.ts';

const mock = await startElevenLabsMock();
// The app's registry-built provider reads its base URL from here at request time.
process.env.ELEVENLABS_API_BASE = mock.url;
after(() => mock.close());

const KEY = 'valid-test-key-0123456789';
const make = (key: string | null = KEY) => createElevenLabsTts({ apiKey: async () => key ?? undefined, baseUrl: mock.url });

// The shared contract, against the mock HTTP layer (the live run is in contract-tts.test.ts).
ttsContract('elevenlabs (mock HTTP)', () => make(), { voiceIds: ['mockVoiceGeorge01'] });

test('character alignment becomes word timings: words split on spaces, first char start to last char end', () => {
  const chars = [...'Hi, there  you.'];
  const t = (i: number) => i * 0.1;
  const words = wordsFromAlignment({ characters: chars, character_start_times_seconds: chars.map((_, i) => t(i)), character_end_times_seconds: chars.map((_, i) => t(i + 1)) });
  assert.deepEqual(words, [
    { text: 'Hi,', startMs: 0, endMs: 300 },
    { text: 'there', startMs: 400, endMs: 900 },
    { text: 'you.', startMs: 1100, endMs: 1500 },
  ]);
  assert.deepEqual(wordsFromAlignment(null), []);
  assert.deepEqual(wordsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }), []);
});

test('word timings are clamped to the audio and starts never go backwards', () => {
  const words = wordsFromAlignment({ characters: ['a', ' ', 'b', ' ', 'c'], character_start_times_seconds: [0.5, 0.6, 0.4, 0.9, 2.0], character_end_times_seconds: [0.6, 0.6, 0.45, 1.0, 2.5] }, 1000);
  assert.deepEqual(words, [
    { text: 'a', startMs: 500, endMs: 600 },
    { text: 'b', startMs: 500, endMs: 500 },
    { text: 'c', startMs: 1000, endMs: 1000 },
  ]);
});

test('voices come from the API with name, language and gender from labels', async () => {
  const voices = await make().voices();
  const george = voices.find((v) => v.id === 'mockVoiceGeorge01')!;
  assert.deepEqual(george, { id: 'mockVoiceGeorge01', name: 'George', language: 'en-GB', gender: 'male', description: 'british, warm, middle aged, narration' });
  assert.equal(voices.find((v) => v.id === 'mockVoiceSarah002')!.language, 'en');
  assert.equal(voices.find((v) => v.id === 'mockVoiceClone003')!.language, 'multilingual');
  assert.equal(voices.find((v) => v.id === 'mockVoiceClone003')!.gender, undefined);
  assert.equal(mock.requests.at(-1)!.key, KEY);
});

test('capabilities: rate as speed 70-120%, pitch, volume and style unsupported with reasons', async () => {
  const caps = await make().capabilities('mockVoiceGeorge01');
  assert.deepEqual(caps, ELEVENLABS_CAPABILITIES);
  assert.deepEqual(caps.controls, { rate: { min: 70, max: 120, default: 100, step: 5, unit: '%' } });
  for (const k of ['pitch', 'volume', 'style'] as const) assert.match(caps.unsupported[k]!, /ElevenLabs/);
  assert.equal(caps.wordTimings, 'native');
});

test('synthesize calls with-timestamps, maps rate to speed (clamped) and writes a WAV', async () => {
  const tts = make();
  const dir = await mkdtemp(join(tmpdir(), 'el-'));
  const n = await tts.synthesize('One two three.', 'mockVoiceGeorge01', {}, join(dir, 'a.wav'));
  const req = mock.requests.at(-1)!;
  assert.equal(req.path, '/v1/text-to-speech/mockVoiceGeorge01/with-timestamps?output_format=pcm_24000');
  assert.deepEqual(req.body, { text: 'One two three.', model_id: 'eleven_multilingual_v2' });
  assert.deepEqual(n.words.map((w) => w.text), ['One', 'two', 'three.']);
  assert.equal((await readFile(n.audioFile)).subarray(0, 4).toString(), 'RIFF');

  await tts.synthesize('Hi', 'mockVoiceGeorge01', { rate: 80, pitch: 10, volume: 3, style: 'news' }, join(dir, 'b.wav'));
  assert.deepEqual(mock.requests.at(-1)!.body.voice_settings, { speed: 0.8 });
  await tts.synthesize('Hi', 'mockVoiceGeorge01', { rate: 500 }, join(dir, 'c.mp3'));
  assert.deepEqual(mock.requests.at(-1)!.body.voice_settings, { speed: 1.2 });
});

test('a missing key fails before any request; a rejected key says so without echoing it', async () => {
  const before = mock.requests.length;
  await assert.rejects(make(null).voices(), (err: any) => err.status === 400 && /no API key.*Settings > Voice providers/.test(err.message));
  assert.equal(mock.requests.length, before);

  const bad = 'sk_bad_key_should_never_be_echoed';
  await assert.rejects(make(bad).voices(), (err: any) => err.status === 400 && /API key rejected \(Invalid API key\)/.test(err.message) && !err.message.includes(bad));
  await assert.rejects(make().synthesize('Hi', 'noSuchVoice', {}, join(tmpdir(), 'x.wav')), /not found/);
});

test('doctor: ElevenLabs check runs only when selected; reports missing, accepted and rejected keys', async () => {
  assert.ok(!providerChecks(DEFAULT_SETTINGS).some((c) => c.id === 'elevenlabs-key'));
  assert.ok(providerChecks(merge(DEFAULT_SETTINGS, { providers: { tts: 'elevenlabs' } })).some((c) => c.id === 'elevenlabs-key'));

  const p = await ensureDataDir(await mkdtemp(join(tmpdir(), 'el-doctor-')));
  const [check] = elevenLabsChecks({ baseUrl: mock.url });
  const missing = await check.run(DEFAULT_SETTINGS, p);
  assert.equal(missing.ok, false);
  assert.match(missing.fix!, /Settings > Voice providers/);

  await setSecret(p, 'elevenlabs', 'apiKey', KEY);
  assert.equal((await check.run(DEFAULT_SETTINGS, p)).ok, true);

  await setSecret(p, 'elevenlabs', 'apiKey', 'nope-secret-value');
  const rejected = await check.run(DEFAULT_SETTINGS, p);
  assert.equal(rejected.ok, false);
  assert.match(rejected.detail, /rejected/);
  assert.ok(!JSON.stringify(rejected).includes('nope-secret-value'));
});

test('secrets: stored 0600 apart from settings, status-only over the API, never in responses or logs', async () => {
  const app = await startTestApp();
  try {
    const secret = 'valid-app-secret-ZXCVBNM-9876';
    const file = join(app.home, 'secrets.json');
    assert.deepEqual(await app.json('/api/secrets'), {});
    const available = (await app.json('/api/settings')).available.tts;
    assert.deepEqual(available.find((p: any) => p.id === 'elevenlabs'), { id: 'elevenlabs', label: 'ElevenLabs', secrets: ['apiKey'] });

    // Without a key the provider explains how to fix it.
    const noKey = await app.api('/api/tts/elevenlabs/voices');
    assert.equal(noKey.status, 400);
    assert.match((await noKey.json()).error, /Settings > Voice providers/);

    assert.deepEqual(await app.json('/api/secrets/elevenlabs', put({ apiKey: secret })), { apiKey: 'set' });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await app.json('/api/secrets'), { elevenlabs: { apiKey: 'set' } });

    // Re-chmod on every write, even if something loosened it.
    await chmod(file, 0o644);
    await app.json('/api/secrets/elevenlabs', put({ apiKey: secret }));
    assert.equal((await stat(file)).mode & 0o777, 0o600);

    // The saved key is used without a restart: voices, then a preview through the real pipeline.
    const voices = await app.json('/api/tts/elevenlabs/voices');
    assert.ok(voices.some((v: any) => v.id === 'mockVoiceGeorge01'));
    assert.equal(mock.requests.at(-1)!.key, secret);
    const { url } = await app.json('/api/tts/preview', post({ provider: 'elevenlabs', voiceId: 'mockVoiceGeorge01', controls: { rate: 110 } }));
    assert.equal((await app.api(url)).status, 200);

    // A rejected key: the error names the fix, not the key.
    const wrong = 'wrong-key-LKJHGFDSA-4321';
    await app.json('/api/secrets/elevenlabs', put({ apiKey: wrong }));
    const rejected = await app.api('/api/tts/elevenlabs/voices');
    const rejectedText = await rejected.text();
    assert.equal(rejected.status, 400);
    assert.ok(!rejectedText.includes(wrong));
    await app.json('/api/secrets/elevenlabs', put({ apiKey: secret }));

    // Bad input and guards.
    assert.equal((await app.api('/api/secrets/elevenlabs', { method: 'PUT', body: JSON.stringify({ apiKey: 'x' }), headers: { 'x-explainer': '0', 'content-type': 'application/json' } })).status, 403);
    assert.equal((await app.api('/api/secrets/polly', put({ apiKey: 'x' }))).status, 404);
    assert.equal((await app.api('/api/secrets/elevenlabs', put({ token: 'x' }))).status, 400);
    assert.equal((await app.api('/api/secrets/elevenlabs', put({ apiKey: 5 }))).status, 400);
    assert.equal((await app.api('/api/settings', put({ elevenlabs: { apiKey: secret } }))).status, 400);

    // Nowhere but secrets.json.
    const everything = [
      JSON.stringify(await app.json('/api/settings')),
      JSON.stringify(await app.json('/api/secrets')),
      JSON.stringify(await app.json('/api/status')),
      await readFile(join(app.home, 'settings.json'), 'utf8'),
      await readFile(join(app.home, 'logs', 'app.log'), 'utf8').catch(() => ''),
    ].join('\n');
    for (const k of [secret, wrong]) assert.ok(!everything.includes(k), 'key leaked');
    assert.ok((await readFile(file, 'utf8')).includes(secret));

    // Empty string deletes.
    assert.deepEqual(await app.json('/api/secrets/elevenlabs', put({ apiKey: '' })), {});
    assert.deepEqual(await app.json('/api/secrets'), {});
    assert.ok(!(await readFile(file, 'utf8')).includes(secret));
    assert.equal((await app.api('/api/tts/elevenlabs/voices')).status, 400);
  } finally {
    await app.stop();
  }
});
