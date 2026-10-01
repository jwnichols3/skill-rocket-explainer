import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kokoroCapabilities, kokoroCheck, cleanTimings, rateToSpeed, KOKORO_VOICES, createKokoroTts } from '../../src/providers/kokoro/tts.ts';
import { kokoroLayout } from '../../src/providers/kokoro/install.ts';
import { providerChecks } from '../../src/providers/registry.ts';
import { DEFAULT_SETTINGS, merge } from '../../src/settings.ts';

test('Kokoro lists English voices with language from the prefix; only rate is a control', () => {
  assert.deepEqual(KOKORO_VOICES.find((v) => v.id === 'af_heart'), { id: 'af_heart', name: 'Heart', language: 'en-US', gender: 'Female', description: 'American English' });
  assert.equal(KOKORO_VOICES.find((v) => v.id === 'bm_george')!.language, 'en-GB');
  const caps = kokoroCapabilities('am_michael');
  assert.deepEqual(Object.keys(caps.controls), ['rate']);
  assert.ok(caps.unsupported.pitch && caps.unsupported.volume && caps.unsupported.style);
  assert.equal(caps.wordTimings, 'native');
  assert.throws(() => kokoroCapabilities('Matthew:neural'), /not a Kokoro voice/);
  assert.deepEqual([rateToSpeed(undefined), rateToSpeed(150), rateToSpeed(10), rateToSpeed(500)], [1, 1.5, 0.5, 2]);
});

test('worker timings are gap-filled, monotonic and clamped to the audio', () => {
  assert.deepEqual(cleanTimings([
    { text: 'a', startMs: 100, endMs: 300 },
    { text: 'b', startMs: null, endMs: null },
    { text: 'c', startMs: 250, endMs: 400 },
    { text: 'd', startMs: 900, endMs: 1200 },
  ], 1000), [
    { text: 'a', startMs: 100, endMs: 300 },
    { text: 'b', startMs: 300, endMs: 300 },
    { text: 'c', startMs: 300, endMs: 400 },
    { text: 'd', startMs: 900, endMs: 1000 },
  ]);
});

test('doctor reports Kokoro missing with an install fix (and uv first when uv is absent)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kokoro-home-'));
  const check = kokoroCheck(() => kokoroLayout({ home }));
  const PATH = process.env.PATH;
  process.env.PATH = await mkdtemp(join(tmpdir(), 'empty-path-'));
  try {
    const r = await check.run(DEFAULT_SETTINGS, { home } as any);
    assert.equal(r.ok, false);
    assert.match(r.detail, /not installed/);
    assert.match(r.fix!, /install uv/);
    assert.match(r.fix!, /node src\/providers\/kokoro\/install\.ts/);
    assert.ok(r.fix!.includes(join(home, 'cache', 'kokoro')));
  } finally {
    process.env.PATH = PATH;
  }
  assert.ok(!providerChecks(DEFAULT_SETTINGS).some((c) => c.id === 'kokoro'));
  assert.ok(providerChecks(merge(DEFAULT_SETTINGS, { providers: { tts: 'kokoro' } })).some((c) => c.id === 'kokoro'));
});

test('synthesize without an install fails with the fix, not a crash', async () => {
  const home = await mkdtemp(join(tmpdir(), 'kokoro-home-'));
  await assert.rejects(createKokoroTts({ home }).synthesize('Hello there.', 'af_heart', {}, join(home, 'a.wav')), /not installed.*install\.ts/);
});
