import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { TtsProvider, Voice, TtsCapabilities, Narration, ControlRange, WordTiming } from '../types.ts';
import type { CheckDef } from '../../doctor.ts';
import { commandVersion } from '../../doctor.ts';
import { ffmpeg, probeDurationMs } from '../../media.ts';
import { defaultHome, paths as dataPaths, type Paths } from '../../datadir.ts';
import { kokoroLayout, kokoroInstalled, INSTALL_COMMAND, type KokoroLayout } from './install.ts';

// Runtime choice and footprint: see install.ts.

/** English voices shipped with Kokoro v1.0. Native timestamps are English-only, so other languages are left out. */
const VOICE_IDS = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky',
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis',
];
const LANGS: Record<string, { code: string; name: string }> = { a: { code: 'en-US', name: 'American English' }, b: { code: 'en-GB', name: 'British English' } };

export const KOKORO_VOICES: Voice[] = VOICE_IDS.map((id) => {
  const lang = LANGS[id[0]];
  const name = id.slice(3);
  return { id, name: name[0].toUpperCase() + name.slice(1), language: lang.code, gender: id[1] === 'f' ? 'Female' : 'Male', description: lang.name };
});

/** Rate maps onto Kokoro's `speed` (100% = 1.0). */
const RATE: ControlRange = { min: 50, max: 200, default: 100, step: 5, unit: '%' };

export function kokoroCapabilities(voiceId: string): TtsCapabilities {
  if (!VOICE_IDS.includes(voiceId)) throw Object.assign(new Error(`not a Kokoro voice: "${voiceId}"`), { status: 404 });
  return {
    controls: { rate: RATE },
    unsupported: {
      pitch: 'Kokoro has no pitch control; pick a different voice instead.',
      volume: 'Kokoro has no volume control; narration is levelled at mix time.',
      style: 'Kokoro voices have no speaking styles; each voice has one delivery.',
    },
    styles: [],
    wordTimings: 'native',
  };
}

export const rateToSpeed = (rate: number | undefined) => Math.min(RATE.max, Math.max(RATE.min, rate ?? RATE.default)) / 100;

/** Worker word timings to contract shape: fill gaps Kokoro left untimed, keep onsets monotonic, stay inside the audio. */
export function cleanTimings(raw: { text: string; startMs: number | null; endMs: number | null }[], durationMs: number): WordTiming[] {
  const out: WordTiming[] = [];
  let prevStart = 0, prevEnd = 0;
  for (const w of raw) {
    let startMs = w.startMs ?? w.endMs ?? prevEnd;
    startMs = Math.min(durationMs, Math.max(prevStart, startMs));
    const endMs = Math.min(durationMs, Math.max(startMs, w.endMs ?? startMs));
    out.push({ text: w.text, startMs, endMs });
    prevStart = startMs; prevEnd = endMs;
  }
  return out;
}

/** Shut the worker down after this long without requests (it holds ~0.5 GB). */
const IDLE_MS = 5 * 60_000;

/**
 * A warm Python worker: model load plus imports cost ~5 s, so it is started on first use and kept for
 * later scenes, then exits after IDLE_MS idle or when this process exits (its stdin closes).
 * Requests are answered in order; the worker synthesizes one at a time.
 */
function createWorker(l: KokoroLayout) {
  let child: ChildProcess | null = null;
  let ready: Promise<void> | null = null;
  let nextId = 1;
  let idleTimer: NodeJS.Timeout | undefined;
  let inflight = 0;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const stderrTail: string[] = [];

  // Keep the event loop alive only while work is in flight.
  const setRef = (on: boolean) => {
    for (const h of [child, child?.stdin, child?.stdout, child?.stderr] as any[]) on ? h?.ref?.() : h?.unref?.();
  };
  const busy = () => {
    clearTimeout(idleTimer);
    setRef(true);
  };
  const maybeIdle = () => {
    if (inflight || !child) return;
    setRef(false);
    clearTimeout(idleTimer);
    const c = child;
    idleTimer = setTimeout(() => c.stdin?.end(), IDLE_MS);
    idleTimer.unref();
  };

  function start(): Promise<void> {
    const c = spawn(l.python, [l.worker, 'serve', l.modelDir], {
      env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONWARNINGS: 'ignore', PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = c;
    return new Promise((resolveReady, rejectReady) => {
      createInterface({ input: c.stdout! }).on('line', (line) => {
        let msg: any;
        try { msg = JSON.parse(line); } catch { return; }
        if (msg.ready) { resolveReady(); return; }
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        msg.ok ? p.resolve(msg) : p.reject(new Error(`Kokoro: ${msg.error}`));
      });
      createInterface({ input: c.stderr! }).on('line', (line) => {
        stderrTail.push(line);
        if (stderrTail.length > 30) stderrTail.shift();
      });
      const died = (why: string) => {
        if (child !== c) return;
        child = null; ready = null;
        clearTimeout(idleTimer);
        const err = new Error(`Kokoro worker ${why}: ${stderrTail.slice(-8).join('\n')}`);
        rejectReady(err);
        for (const p of pending.values()) p.reject(err);
        pending.clear();
      };
      c.on('error', (e) => died(`failed to start (${e.message})`));
      c.on('exit', (code, signal) => died(`exited (${signal ?? code})`));
    });
  }

  return async function request(req: { text: string; voice: string; speed: number; out: string }): Promise<{ words: any[]; samples: number }> {
    inflight++;
    try {
      ready ??= start();
      busy();
      await ready;
      const id = nextId++;
      const result = new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
      child!.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
      return await result;
    } finally {
      inflight--;
      maybeIdle();
    }
  };
}

export function createKokoroTts(p: Pick<Paths, 'home'>): TtsProvider {
  const l = kokoroLayout(p);
  const request = createWorker(l);
  let installed = false;

  return {
    id: 'kokoro',
    label: 'Kokoro (local)',
    async voices() { return KOKORO_VOICES; },
    async capabilities(voiceId) { return kokoroCapabilities(voiceId); },
    async synthesize(text, voiceId, controls, outFile): Promise<Narration> {
      kokoroCapabilities(voiceId); // validates the id
      if (!installed) {
        const s = await kokoroInstalled(l);
        if (!s.ok) throw new Error(`Kokoro is not installed (${s.detail}). Fix: run \`${INSTALL_COMMAND}\``);
        installed = true;
      }
      const wav = extname(outFile).toLowerCase() === '.wav' ? outFile : `${outFile}.${crypto.randomUUID().slice(0, 8)}.kokoro.wav`;
      try {
        const r = await request({ text, voice: voiceId, speed: rateToSpeed(controls.rate), out: wav });
        if (wav !== outFile) await ffmpeg(['-i', wav, outFile]);
        const durationMs = await probeDurationMs(outFile);
        return { audioFile: outFile, durationMs, words: cleanTimings(r.words, durationMs) };
      } finally {
        if (wav !== outFile) await rm(wav, { force: true });
      }
    },
  };
}

/** Doctor: the venv and model are installed; if not, the fix says how (and to get uv first when missing). */
export function kokoroCheck(layout: () => KokoroLayout): CheckDef {
  return {
    id: 'kokoro',
    label: 'Kokoro local TTS',
    async run() {
      const l = layout();
      const s = await kokoroInstalled(l);
      if (s.ok) return s;
      const uv = await commandVersion('uv');
      const fix = `${uv ? '' : 'install uv (https://docs.astral.sh/uv/getting-started/installation/), then '}run \`${INSTALL_COMMAND}\` from the app folder (downloads ~1.2 GB into ${l.dir})`;
      return { ok: false, detail: s.detail, fix };
    },
  };
}

export const kokoroChecks: CheckDef[] = [kokoroCheck(() => kokoroLayout(dataPaths(defaultHome())))];
