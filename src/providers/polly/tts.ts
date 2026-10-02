import { PollyClient, DescribeVoicesCommand, SynthesizeSpeechCommand, type Engine, type SynthesizeSpeechCommandInput } from '@aws-sdk/client-polly';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { writeFile, rename, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { TtsProvider, Voice, TtsCapabilities, VoiceControls, Narration, ControlRange } from '../types.ts';
import type { Settings } from '../../settings.ts';
import type { CheckDef } from '../../doctor.ts';
import { ffmpeg, probeDurationMs } from '../../media.ts';
import { detectSilences, alignWords, wordsFromOnsets } from '../../align.ts';

export type PollySettings = Settings['polly'];

const ENGINES = ['generative', 'long-form', 'neural', 'standard'] as const;
type PollyEngine = (typeof ENGINES)[number];

/** Long-form only exists in us-east-1. */
const LONG_FORM_REGION = 'us-east-1';
/** Voices that accept <amazon:domain name="news"> (neural only). Verified against the API. */
const NEWSCASTER_VOICES = ['Matthew', 'Joanna', 'Lupe', 'Amy'];

const RATE: ControlRange = { min: 20, max: 200, default: 100, step: 5, unit: '%' };
const VOLUME: ControlRange = { min: -6, max: 6, default: 0, step: 1, unit: 'dB' };
const PITCH: ControlRange = { min: -20, max: 20, default: 0, step: 1, unit: '%' };

export function client(cfg: PollySettings): PollyClient {
  return new PollyClient({ region: cfg.region, credentials: fromNodeProviderChain(cfg.profile ? { profile: cfg.profile } : {}) });
}

/** How to fix missing/expired credentials, naming the configured profile. */
export function credentialsFix(cfg: PollySettings): string {
  return cfg.profile
    ? `run \`aws sso login --profile ${cfg.profile}\` (or refresh that profile's keys); change the profile in Settings > Voices > Amazon Polly`
    : 'configure AWS credentials (`aws configure`, `aws sso login`, or AWS_* env vars), or pick a profile in Settings > Voices > Amazon Polly';
}

/** Voice ids are "<Name>:<engine>", one per engine the voice supports. */
export function parseVoiceId(voiceId: string): { name: string; engine: PollyEngine } {
  const [name, engine] = voiceId.split(':');
  if (!name || !ENGINES.includes(engine as PollyEngine)) throw Object.assign(new Error(`not a Polly voice id: "${voiceId}" (expected Name:engine)`), { status: 404 });
  return { name, engine: engine as PollyEngine };
}

/** What each engine honours. Unsupported SSML is an error on Polly, so synthesize drops what this says is unsupported. */
export function pollyCapabilities(voiceId: string, region: string): TtsCapabilities {
  const { name, engine } = parseVoiceId(voiceId);
  if (engine === 'long-form' && region !== LONG_FORM_REGION) throw Object.assign(new Error(`long-form voices only exist in ${LONG_FORM_REGION} (polly.region is ${region})`), { status: 400 });
  const caps: TtsCapabilities = { controls: { rate: RATE, volume: VOLUME }, unsupported: {}, styles: [], wordTimings: engine === 'generative' ? 'aligned' : 'native' };
  if (engine === 'standard') caps.controls.pitch = PITCH;
  else caps.unsupported.pitch = `The ${engine} engine does not support pitch (standard voices do).`;
  if (engine === 'neural' && NEWSCASTER_VOICES.includes(name)) caps.styles = ['news'];
  else if (engine === 'neural') caps.unsupported.style = `Newscaster style is only available for ${NEWSCASTER_VOICES.join(', ')}.`;
  else caps.unsupported.style = `No speaking styles on the ${engine} engine (newscaster needs a neural voice).`;
  return caps;
}

const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const unescapeXml = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e as string]!);
const clamp = (v: number, r: ControlRange) => Math.min(r.max, Math.max(r.min, Math.round(v)));
const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/** SSML for the text with only the controls this voice supports. */
export function buildSsml(text: string, voiceId: string, controls: VoiceControls, region: string): string {
  const caps = pollyCapabilities(voiceId, region);
  const attrs: string[] = [];
  const { rate, pitch, volume } = caps.controls;
  if (rate && controls.rate != null && controls.rate !== rate.default) attrs.push(`rate="${clamp(controls.rate, rate)}%"`);
  if (pitch && controls.pitch != null && controls.pitch !== pitch.default) attrs.push(`pitch="${signed(clamp(controls.pitch, pitch))}%"`);
  if (volume && controls.volume != null && controls.volume !== volume.default) attrs.push(`volume="${signed(clamp(controls.volume, volume))}dB"`);
  let body = escapeXml(text);
  if (attrs.length) body = `<prosody ${attrs.join(' ')}>${body}</prosody>`;
  if (controls.style && caps.styles.includes(controls.style)) body = `<amazon:domain name="${controls.style}">${body}</amazon:domain>`;
  return `<speak>${body}</speak>`;
}

function wrapAwsError(err: any, cfg: PollySettings): Error {
  const name = String(err?.name ?? '');
  if (/Credential|Token|Expired|Unrecognized|SSO|AccessDenied|InvalidSignature/i.test(name + ' ' + (err?.message ?? ''))) {
    return new Error(`Polly: AWS credentials not usable (${err.message}). Fix: ${credentialsFix(cfg)}`);
  }
  return new Error(`Polly: ${err?.message ?? err}`);
}

export function createPollyTts(cfg: () => PollySettings): TtsProvider {
  const settings = cfg();
  const polly = client(settings);
  let voiceList: Promise<Voice[]> | null = null;

  async function send<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); } catch (err) { throw wrapAwsError(err, settings); }
  }

  async function loadVoices(): Promise<Voice[]> {
    const out: Voice[] = [];
    let NextToken: string | undefined;
    do {
      const r = await send(() => polly.send(new DescribeVoicesCommand({ NextToken })));
      for (const v of r.Voices ?? []) {
        for (const engine of ENGINES) {
          if (!v.SupportedEngines?.includes(engine) || !v.Id) continue;
          if (engine === 'long-form' && settings.region !== LONG_FORM_REGION) continue;
          out.push({ id: `${v.Id}:${engine}`, name: v.Name ?? v.Id, language: v.LanguageCode ?? '', gender: v.Gender, engine, description: v.LanguageName });
        }
      }
      NextToken = r.NextToken;
    } while (NextToken);
    // en-US first (the likely pick), then by language, name and engine.
    const rank = (v: Voice) => (v.language === 'en-US' ? '0' : '1') + v.language;
    return out.sort((a, b) => rank(a).localeCompare(rank(b)) || a.name.localeCompare(b.name) || a.engine!.localeCompare(b.engine!));
  }

  async function speak(input: Omit<SynthesizeSpeechCommandInput, 'VoiceId' | 'Engine' | 'Text' | 'TextType'>, name: string, engine: PollyEngine, ssml: string): Promise<Uint8Array> {
    const r = await send(() => polly.send(new SynthesizeSpeechCommand({ ...input, VoiceId: name as any, Engine: engine as Engine, Text: ssml, TextType: 'ssml' })));
    return r.AudioStream!.transformToByteArray();
  }

  return {
    id: 'polly',
    label: 'Amazon Polly',
    voices() {
      voiceList ??= loadVoices().catch((err) => { voiceList = null; throw err; });
      return voiceList;
    },
    async capabilities(voiceId) { return pollyCapabilities(voiceId, settings.region); },
    async synthesize(text, voiceId, controls, outFile): Promise<Narration> {
      const { name, engine } = parseVoiceId(voiceId);
      const ssml = buildSsml(text, voiceId, controls, settings.region);
      const native = pollyCapabilities(voiceId, settings.region).wordTimings === 'native';
      const [audio, marks] = await Promise.all([
        speak({ OutputFormat: 'mp3', SampleRate: '24000' }, name, engine, ssml),
        native ? speak({ OutputFormat: 'json', SpeechMarkTypes: ['word'] }, name, engine, ssml) : null,
      ]);

      // Polly returns mp3; callers usually want a real WAV at outFile.
      const mp3 = `${outFile}.${crypto.randomUUID().slice(0, 8)}.polly.mp3`;
      await writeFile(mp3, audio);
      try {
        if (extname(outFile).toLowerCase() === '.mp3') await rename(mp3, outFile);
        else await ffmpeg(['-i', mp3, '-ac', '1', '-c:a', 'pcm_s16le', outFile]);
      } finally {
        await rm(mp3, { force: true });
      }
      const durationMs = await probeDurationMs(outFile);
      const silences = await detectSilences(outFile, durationMs);

      if (!marks) return { audioFile: outFile, durationMs, words: alignWords(text, silences, durationMs) };
      const onsets = Buffer.from(marks).toString('utf8').split('\n').filter(Boolean)
        .map((l) => JSON.parse(l)).filter((m) => m.type === 'word')
        .map((m) => ({ text: unescapeXml(String(m.value)), startMs: Math.min(Number(m.time), durationMs) }));
      return { audioFile: outFile, durationMs, words: wordsFromOnsets(onsets, silences, durationMs) };
    },
  };
}

/** Doctor: credentials resolve for the configured profile and Polly answers (a cheap DescribeVoices). */
export const pollyChecks: CheckDef[] = [{
  id: 'polly-credentials',
  label: 'Amazon Polly access',
  async run(s) {
    const cfg = s.polly;
    const where = `region ${cfg.region}, ${cfg.profile ? `profile ${cfg.profile}` : 'default credential chain'}`;
    try {
      await client(cfg).send(new DescribeVoicesCommand({ LanguageCode: 'en-US' }), { abortSignal: AbortSignal.timeout(15_000) });
      return { ok: true, detail: where };
    } catch (err: any) {
      return { ok: false, detail: `${where}: ${err?.message ?? err}`, fix: credentialsFix(cfg) };
    }
  },
}];
