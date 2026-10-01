import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ffmpeg, probeDurationMs } from '../../src/media.ts';
import { detectSilences, speechSpans, alignWords, wordsFromOnsets } from '../../src/align.ts';

test('silencedetect finds the pauses between tone bursts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'align-'));
  const file = join(dir, 'bursts.wav');
  // 0.8 s tone, 0.5 s silence, 1.2 s tone, 0.3 s silence.
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=0.8', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.5',
    '-f', 'lavfi', '-i', 'sine=frequency=300:duration=1.2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=0.3',
    '-filter_complex', '[0][1][2][3]concat=n=4:v=0:a=1', '-ac', '1', file]);
  const dur = await probeDurationMs(file);
  const silences = await detectSilences(file, dur);
  assert.equal(silences.length, 2, JSON.stringify(silences));
  assert.ok(Math.abs(silences[0].startMs - 800) < 60 && Math.abs(silences[0].endMs - 1300) < 60, JSON.stringify(silences));
  assert.equal(silences[1].endMs, dur);
  assert.deepEqual(speechSpans(silences, dur).length, 2);
});

test('alignment snaps pauses to punctuation and stays monotonic and inside the audio', () => {
  const silences = [{ startMs: 800, endMs: 1300 }, { startMs: 2500, endMs: 2800 }];
  const words = alignWords('Hello there. How are you doing today?', silences, 2800);
  assert.equal(words.length, 7);
  assert.equal(words[1].text, 'there.');
  assert.ok(words[1].endMs <= 800 && words[2].startMs >= 1300, JSON.stringify(words));
  let prev = 0;
  for (const w of words) { assert.ok(w.startMs >= prev && w.endMs >= w.startMs); prev = w.startMs; }
  assert.equal(words.at(-1)!.endMs, 2500);
});

test('alignment with no detected pauses spreads equal-length words evenly over the whole clip', () => {
  const words = alignWords('one two six', [], 900);
  assert.deepEqual(words.map((w) => [w.startMs, w.endMs]), [[0, 300], [300, 600], [600, 900]]);
});

test('native onsets end at the next onset or the pause before it', () => {
  const words = wordsFromOnsets([{ text: 'Hi.', startMs: 50 }, { text: 'Bye', startMs: 900 }], [{ startMs: 400, endMs: 880 }, { startMs: 1300, endMs: 1500 }], 1500);
  assert.deepEqual(words, [{ text: 'Hi.', startMs: 50, endMs: 400 }, { text: 'Bye', startMs: 900, endMs: 1300 }]);
});
