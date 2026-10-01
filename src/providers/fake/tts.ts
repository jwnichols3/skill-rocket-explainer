import type { TtsProvider, Voice, TtsCapabilities, VoiceControls, Narration } from '../types.ts';
import { writeSilentWav } from '../../media.ts';

const VOICES: Voice[] = [
  { id: 'fake-bright', name: 'Bright (fake)', language: 'en-US', engine: 'neural' },
  { id: 'fake-deep', name: 'Deep (fake)', language: 'en-GB', engine: 'generative' },
];

const MS_PER_WORD = 320;
const GAP_MS = 250;

/** Silent audio whose length follows the text, with synthetic word timings. For tests. */
export function createFakeTts(): TtsProvider {
  return {
    id: 'fake',
    label: 'Fake TTS (silent, for tests)',
    async voices() { return VOICES; },
    async capabilities(voiceId): Promise<TtsCapabilities> {
      if (voiceId === 'fake-deep') {
        return {
          controls: { rate: { min: 20, max: 200, default: 100, step: 5, unit: '%' }, volume: { min: -6, max: 6, default: 0, step: 1, unit: 'dB' } },
          unsupported: { pitch: 'This engine ignores pitch.', style: 'No speaking styles on this engine.' },
          styles: [],
          wordTimings: 'aligned',
        };
      }
      return {
        controls: { rate: { min: 20, max: 200, default: 100, step: 5, unit: '%' }, pitch: { min: -20, max: 20, default: 0, step: 1, unit: '%' }, volume: { min: -6, max: 6, default: 0, step: 1, unit: 'dB' } },
        unsupported: {},
        styles: ['news'],
        wordTimings: 'native',
      };
    },
    async synthesize(text: string, voiceId: string, controls: VoiceControls, outFile: string): Promise<Narration> {
      if (!VOICES.some((v) => v.id === voiceId)) throw new Error(`unknown voice ${voiceId}`);
      const rate = (controls.rate ?? 100) / 100;
      const per = MS_PER_WORD / rate;
      const tokens = text.split(/\s+/).filter(Boolean);
      const words = tokens.map((t, i) => ({ text: t, startMs: Math.round(GAP_MS + i * per), endMs: Math.round(GAP_MS + (i + 1) * per - 40) }));
      const durationMs = Math.round(GAP_MS * 2 + tokens.length * per);
      await writeSilentWav(outFile, durationMs);
      return { audioFile: outFile, durationMs, words };
    },
  };
}
