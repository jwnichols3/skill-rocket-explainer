import { exec } from './media.ts';
import type { WordTiming } from './providers/types.ts';

/**
 * Word timings for engines that return none (Polly generative, and any future TTS without marks).
 *
 * Approach: silence-aware proportional alignment. ffmpeg `silencedetect` finds the pauses; words are
 * spread over the speech between pauses by character weight, and each pause is snapped to a word
 * boundary, preferring boundaries after punctuation (where speakers actually pause).
 *
 * Tradeoff, and why not the alternatives:
 * - Accuracy: close at pauses, approximate inside a phrase. Measured against Polly neural speech
 *   marks on four voices: median word-onset error ~120 ms, p90 ~260 ms. Good enough for text
 *   pop-ups and highlights that land per phrase; not for lip sync.
 * - Whisper/Parakeet word timestamps would be more precise but add a large local install (model
 *   weights, Python or a native build) for a fallback path.
 * - Re-synthesizing with the same voice's neural engine just for speech marks doubles the API calls,
 *   fails for voices with no neural twin, and pauses differ between engines, so it still needs a
 *   correction step like this one.
 * This needs only ffmpeg, which the app already requires, and costs nothing per call.
 */

export interface Span { startMs: number; endMs: number }

/** Pauses in an audio file via ffmpeg silencedetect. */
export async function detectSilences(file: string, durationMs: number, opts: { noiseDb?: number; minMs?: number } = {}): Promise<Span[]> {
  const { noiseDb = -40, minMs = 150 } = opts;
  const r = await exec('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `silencedetect=noise=${noiseDb}dB:d=${minMs / 1000}`, '-f', 'null', '-']);
  if (r.code !== 0) throw new Error(`silencedetect failed on ${file}: ${r.stderr.trim().slice(-500)}`);
  const out: Span[] = [];
  for (const m of r.stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const ms = Math.max(0, Math.round(parseFloat(m[2]) * 1000));
    if (m[1] === 'start') out.push({ startMs: ms, endMs: durationMs });
    else if (out.length) out[out.length - 1].endMs = Math.min(ms, durationMs);
  }
  return out;
}

/** The non-silent stretches between pauses. */
export function speechSpans(silences: Span[], durationMs: number): Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const s of [...silences].sort((a, b) => a.startMs - b.startMs)) {
    if (s.startMs - at >= 30) spans.push({ startMs: at, endMs: s.startMs });
    at = Math.max(at, s.endMs);
  }
  if (durationMs - at >= 30) spans.push({ startMs: at, endMs: durationMs });
  return spans;
}

const PUNCTUATED = /[,.;:!?…)"'”’-]$/;
/** In weight units (letters + 1 per word): slightly under one average word. */
const PUNCT_BONUS = 4;

/** Forced alignment without a model: see the module comment. */
export function alignWords(text: string, silences: Span[], durationMs: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  let spans = speechSpans(silences, durationMs);
  if (!spans.length) spans = [{ startMs: 0, endMs: durationMs }];

  const weights = tokens.map((t) => t.replace(/[^\p{L}\p{N}]/gu, '').length + 1);
  const cum: number[] = [0]; // cum[i] = weight of the first i words
  for (const w of weights) cum.push(cum[cum.length - 1] + w);
  const total = cum[tokens.length];
  const speechMs = spans.reduce((a, s) => a + s.endMs - s.startMs, 0);

  // breaks[k] = index of the first word spoken in span k.
  const breaks = [0];
  let elapsed = 0;
  for (let k = 0; k < spans.length - 1; k++) {
    elapsed += spans[k].endMs - spans[k].startMs;
    const target = (elapsed / speechMs) * total;
    const from = breaks[breaks.length - 1];
    let best = from, bestCost = Infinity;
    for (let i = from; i <= tokens.length; i++) {
      const bonus = i > 0 && i < tokens.length && PUNCTUATED.test(tokens[i - 1]) ? PUNCT_BONUS : 0;
      const cost = Math.abs(cum[i] - target) - bonus;
      if (cost < bestCost) { best = i; bestCost = cost; }
    }
    breaks.push(best);
  }
  breaks.push(tokens.length);

  const words: WordTiming[] = [];
  spans.forEach((span, k) => {
    const [a, b] = [breaks[k], breaks[k + 1]];
    const groupWeight = cum[b] - cum[a];
    const dur = span.endMs - span.startMs;
    for (let i = a; i < b; i++) {
      words.push({
        text: tokens[i],
        startMs: Math.round(span.startMs + (dur * (cum[i] - cum[a])) / groupWeight),
        endMs: Math.round(span.startMs + (dur * (cum[i + 1] - cum[a])) / groupWeight),
      });
    }
  });
  return words;
}

/** Native onsets (e.g. Polly speech marks) to full timings: a word ends at the next onset or at the pause after it. */
export function wordsFromOnsets(onsets: { text: string; startMs: number }[], silences: Span[], durationMs: number): WordTiming[] {
  return onsets.map((w, i) => {
    const next = onsets[i + 1]?.startMs ?? durationMs;
    const pause = silences.find((s) => s.startMs > w.startMs && s.startMs < next);
    return { text: w.text, startMs: w.startMs, endMs: Math.max(w.startMs, pause ? pause.startMs : next) };
  });
}
