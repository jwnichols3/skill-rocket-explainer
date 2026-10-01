import { writeFile, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { TtsProvider, Voice, TtsCapabilities, Narration, ControlRange, WordTiming } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { defaultHome, paths as dataPaths } from '../../datadir.ts';
import { getSecret } from '../../secrets.ts';
import { ffmpeg, probeDurationMs } from '../../media.ts';

/**
 * ElevenLabs TTS. This is the template for API-key providers: see docs/adding-a-tts-provider.md.
 *
 * - The API key lives in <home>/secrets.json (src/secrets.ts), entered in Settings > Voice providers.
 * - Voices come from GET /v1/voices; ids are ElevenLabs voice_ids.
 * - Synthesis uses POST /v1/text-to-speech/:voice/with-timestamps, which returns base64 audio plus
 *   character-level alignment; wordsFromAlignment() turns that into word timings.
 */

export const PROVIDER_ID = 'elevenlabs';
export const KEY_FIX = 'add your ElevenLabs API key in Settings > Voice providers';
/** Multilingual v2: the general-purpose model that honours voice_settings.speed. */
export const DEFAULT_MODEL = 'eleven_multilingual_v2';
/** Raw 16-bit mono PCM: no decoder delay, so the alignment lines up with the samples exactly. */
const OUTPUT_FORMAT = 'pcm_24000';
const SAMPLE_RATE = 24000;

/**
 * ElevenLabs `speed` runs 0.7-1.2; exposed as 70-120% so it reads like the other providers' rate.
 * Only rate maps onto the shared control set. ElevenLabs' other knobs (stability, similarity, style
 * exaggeration) are voice-character settings with no equivalent in VoiceControls; they could be
 * added as new controls later, and until then the voice's defaults apply.
 */
const RATE: ControlRange = { min: 70, max: 120, default: 100, step: 5, unit: '%' };

export const ELEVENLABS_CAPABILITIES: TtsCapabilities = {
  controls: { rate: RATE },
  unsupported: {
    pitch: 'ElevenLabs has no pitch control; the register comes from the voice itself.',
    volume: 'ElevenLabs has no volume control; its output is already loudness-normalized.',
    style: 'ElevenLabs voices have no named speaking styles; the delivery comes from the voice itself.',
  },
  styles: [],
  wordTimings: 'native',
};

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Character alignment to word timings. A word is a run of non-space characters; it starts at its
 * first character's start and ends at its last character's end. Times are clamped to the audio and
 * starts are kept monotonic, since the contract (and the renderers) rely on both.
 */
export function wordsFromAlignment(a: Alignment | null | undefined, durationMs = Infinity): WordTiming[] {
  if (!a?.characters?.length) return [];
  const words: WordTiming[] = [];
  let cur: { text: string; start: number; end: number } | null = null;
  const flush = () => { if (cur) words.push({ text: cur.text, startMs: cur.start, endMs: cur.end }); cur = null; };
  a.characters.forEach((ch, i) => {
    if (/^\s*$/.test(ch)) { flush(); return; }
    const start = Math.round((a.character_start_times_seconds[i] ?? 0) * 1000);
    const end = Math.round((a.character_end_times_seconds[i] ?? 0) * 1000);
    if (!cur) cur = { text: '', start, end };
    cur.text += ch;
    cur.end = Math.max(cur.end, end);
  });
  flush();
  let prev = 0;
  for (const w of words) {
    w.startMs = Math.min(Math.max(w.startMs, prev), durationMs);
    w.endMs = Math.min(Math.max(w.endMs, w.startMs), durationMs);
    prev = w.startMs;
  }
  return words;
}

/** An Error carrying an HTTP status for the API layer. Messages never contain the key. */
const fail = (status: number, message: string) => Object.assign(new Error(`ElevenLabs: ${message}`), { status });

export interface ElevenLabsOptions {
  /** Resolves the API key at call time, so a key saved in Settings applies without a restart. */
  apiKey: () => Promise<string | undefined>;
  /** Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Defaults to $ELEVENLABS_API_BASE or https://api.elevenlabs.io (set it for data residency or a mock). */
  baseUrl?: string;
  model?: string;
}

export const defaultBaseUrl = () => process.env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io';

/** One authenticated JSON request. Maps missing/rejected keys to errors whose fix names Settings. */
async function request(opts: ElevenLabsOptions, path: string, init: RequestInit = {}): Promise<any> {
  const key = await opts.apiKey();
  if (!key) throw fail(400, `no API key. Fix: ${KEY_FIX}`);
  const doFetch = opts.fetch ?? fetch;
  const scrub = (s: string) => s.split(key).join('***');
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? defaultBaseUrl()}${path}`, {
      ...init,
      headers: { 'xi-api-key': key, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      signal: init.signal ?? AbortSignal.timeout(120_000),
    });
  } catch (err: any) {
    throw fail(502, `request failed (${scrub(String(err?.message ?? err))})`);
  }
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  if (res.ok) return body;
  const detail = scrub(String(body?.detail?.message ?? body?.detail?.status ?? body?.detail ?? (text.slice(0, 300) || res.statusText)));
  if (res.status === 401 || res.status === 403) throw fail(400, `API key rejected (${detail}). Fix: ${KEY_FIX}`);
  if (res.status === 404) throw fail(404, `not found (${detail})`);
  throw fail(502, `HTTP ${res.status} (${detail})`);
}

function toVoice(v: any): Voice {
  const labels: Record<string, string> = v.labels ?? {};
  const verified = Array.isArray(v.verified_languages) ? v.verified_languages[0] : undefined;
  const description = [labels.accent, labels.description ?? labels.descriptive, labels.age, labels.use_case].filter(Boolean).join(', ');
  return {
    id: String(v.voice_id),
    name: String(v.name ?? v.voice_id),
    // Multilingual models speak many languages with any voice; the label is the voice's native one.
    language: String(verified?.locale ?? labels.language ?? verified?.language ?? v.fine_tuning?.language ?? 'multilingual'),
    gender: labels.gender || undefined,
    description: description || v.description || undefined,
  };
}

export function createElevenLabsTts(opts: ElevenLabsOptions): TtsProvider {
  const model = opts.model ?? DEFAULT_MODEL;
  let voiceList: Promise<Voice[]> | null = null;

  async function loadVoices(): Promise<Voice[]> {
    const r = await request(opts, '/v1/voices');
    const voices = (Array.isArray(r?.voices) ? r.voices : []).filter((v: any) => v?.voice_id).map(toVoice);
    const rank = (v: Voice) => (v.language.startsWith('en') ? '0' : '1') + v.language;
    return voices.sort((a: Voice, b: Voice) => rank(a).localeCompare(rank(b)) || a.name.localeCompare(b.name));
  }

  return {
    id: PROVIDER_ID,
    label: 'ElevenLabs',
    voices() {
      voiceList ??= loadVoices().catch((err) => { voiceList = null; throw err; });
      return voiceList;
    },
    async capabilities() { return ELEVENLABS_CAPABILITIES; },
    async synthesize(text, voiceId, controls, outFile): Promise<Narration> {
      const body: Record<string, unknown> = { text, model_id: model };
      if (controls.rate != null && controls.rate !== RATE.default) {
        const rate = Math.min(RATE.max, Math.max(RATE.min, controls.rate));
        body.voice_settings = { speed: rate / 100 };
      }
      const r = await request(opts, `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${OUTPUT_FORMAT}`, { method: 'POST', body: JSON.stringify(body) });
      if (typeof r?.audio_base64 !== 'string') throw fail(502, 'response had no audio');

      const raw = `${outFile}.${crypto.randomUUID().slice(0, 8)}.elevenlabs.pcm`;
      await writeFile(raw, Buffer.from(r.audio_base64, 'base64'));
      try {
        const codec = extname(outFile).toLowerCase() === '.mp3' ? [] : ['-c:a', 'pcm_s16le'];
        await ffmpeg(['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', raw, ...codec, outFile]);
      } finally {
        await rm(raw, { force: true });
      }
      const durationMs = await probeDurationMs(outFile);
      return { audioFile: outFile, durationMs, words: wordsFromAlignment(r.alignment ?? r.normalized_alignment, durationMs) };
    },
  };
}

/**
 * Doctor: the key is present, and ElevenLabs accepts it (a cheap GET /v1/voices).
 * Doctor runs from the CLI with only settings, so the data dir comes from the same place the CLI uses.
 */
export function elevenLabsChecks(deps: { paths?: () => ReturnType<typeof dataPaths>; fetch?: typeof fetch; baseUrl?: string } = {}): CheckDef[] {
  const where = deps.paths ?? (() => dataPaths(defaultHome()));
  return [{
    id: 'elevenlabs-key',
    label: 'ElevenLabs API key',
    async run() {
      const key = await getSecret(where(), PROVIDER_ID, 'apiKey');
      if (!key) return { ok: false, detail: 'not set', fix: KEY_FIX };
      try {
        await request({ apiKey: async () => key, fetch: deps.fetch, baseUrl: deps.baseUrl }, '/v1/voices', { signal: AbortSignal.timeout(15_000) });
        return { ok: true, detail: 'set and accepted' };
      } catch (err: any) {
        return { ok: false, detail: `set, but ${String(err?.message ?? err).replace(/ Fix: .*$/, '')}`, fix: KEY_FIX };
      }
    },
  }];
}
