import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TtsProvider } from '../../src/providers/types.ts';
import { probeDurationMs } from '../../src/media.ts';

/**
 * Shared TTS contract. Every provider must pass it.
 * `voiceIds` picks which voices to exercise (e.g. one per engine).
 */
export function ttsContract(name: string, make: () => TtsProvider | Promise<TtsProvider>, opts: { voiceIds: string[]; skip?: string | false; timeout?: number }) {
  const t = (title: string, fn: () => Promise<void>) => test(`[tts contract: ${name}] ${title}`, { skip: opts.skip, timeout: opts.timeout ?? 60_000 }, fn);

  t('lists voices', async () => {
    const tts = await make();
    const voices = await tts.voices();
    assert.ok(voices.length > 0, 'no voices');
    for (const v of voices) assert.ok(v.id && v.name && v.language, `incomplete voice ${JSON.stringify(v)}`);
    for (const id of opts.voiceIds) assert.ok(voices.some((v) => v.id === id), `voice ${id} not listed`);
  });

  for (const voiceId of opts.voiceIds) {
    t(`${voiceId}: timings present, monotonic and covering the audio`, async () => {
      const tts = await make();
      const dir = await mkdtemp(join(tmpdir(), 'tts-contract-'));
      const text = 'The quick brown fox explains the internet in seven short words.';
      const n = await tts.synthesize(text, voiceId, {}, join(dir, 'a.wav'));
      const actual = await probeDurationMs(n.audioFile);
      assert.ok(Math.abs(actual - n.durationMs) < 250, `reported ${n.durationMs}ms, file is ${actual}ms`);
      assert.ok(n.words.length >= 8, `only ${n.words.length} word timings`);
      let prev = 0;
      for (const w of n.words) {
        assert.ok(w.startMs >= prev - 1, `timings go backwards at "${w.text}"`);
        assert.ok(w.endMs >= w.startMs, `word "${w.text}" ends before it starts`);
        prev = w.startMs;
      }
      const last = n.words.at(-1)!;
      assert.ok(last.endMs <= actual + 250, `last word ends at ${last.endMs}ms after the audio (${actual}ms)`);
      assert.ok(last.endMs >= actual * 0.6, `timings cover only ${last.endMs}ms of ${actual}ms`);
    });

    t(`${voiceId}: capabilities match what synthesize honours`, async () => {
      const tts = await make();
      const caps = await tts.capabilities(voiceId);
      const dir = await mkdtemp(join(tmpdir(), 'tts-contract-'));
      const text = 'Speed changes how long this sentence takes to say out loud.';
      const base = await tts.synthesize(text, voiceId, {}, join(dir, 'base.wav'));
      if (caps.controls.rate) {
        const fast = await tts.synthesize(text, voiceId, { rate: Math.min(caps.controls.rate.max, 150) }, join(dir, 'fast.wav'));
        assert.ok(fast.durationMs < base.durationMs * 0.9, `rate 150 not honoured: ${fast.durationMs}ms vs ${base.durationMs}ms`);
      } else {
        assert.ok(caps.unsupported.rate, 'rate neither supported nor explained');
      }
      for (const k of ['pitch', 'volume'] as const) assert.ok(caps.controls[k] || caps.unsupported[k], `${k} neither supported nor explained`);
      assert.ok(caps.styles.length > 0 || caps.unsupported.style, 'style neither supported nor explained');
    });
  }
}
