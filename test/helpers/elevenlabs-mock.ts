import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local stand-in for the ElevenLabs REST API: just the endpoints the provider uses, shaped like
 * the real responses. Keys starting with "valid-" are accepted; anything else gets a 401.
 * Speech is a tone, 70 ms per character divided by voice_settings.speed, with matching alignment.
 */
export const MOCK_VOICES = [
  { voice_id: 'mockVoiceGeorge01', name: 'George', category: 'premade', labels: { accent: 'british', description: 'warm', age: 'middle aged', gender: 'male', use_case: 'narration' }, verified_languages: [{ language: 'en', locale: 'en-GB', model_id: 'eleven_multilingual_v2' }] },
  { voice_id: 'mockVoiceSarah002', name: 'Sarah', category: 'premade', labels: { accent: 'american', gender: 'female', language: 'en' } },
  { voice_id: 'mockVoiceClone003', name: 'My clone', category: 'cloned', labels: {} },
];

const RATE = 24000;
const MS_PER_CHAR = 70;
const LEAD_MS = 200;

export interface MockRequest { method: string; path: string; key?: string; body?: any }

export async function startElevenLabsMock() {
  const requests: MockRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
    const key = req.headers['xi-api-key'] as string | undefined;
    requests.push({ method: req.method ?? 'GET', path: url.pathname + url.search, key, body });
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };

    if (!key?.startsWith('valid-')) return send(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
    if (req.method === 'GET' && url.pathname === '/v1/voices') return send(200, { voices: MOCK_VOICES });
    const m = /^\/v1\/text-to-speech\/([^/]+)\/with-timestamps$/.exec(url.pathname);
    if (req.method === 'POST' && m) {
      if (!MOCK_VOICES.some((v) => v.voice_id === decodeURIComponent(m[1]))) return send(404, { detail: { status: 'voice_not_found', message: 'A voice with that ID does not exist.' } });
      if (url.searchParams.get('output_format') !== 'pcm_24000') return send(400, { detail: 'mock only speaks pcm_24000' });
      return send(200, speak(String(body?.text ?? ''), Number(body?.voice_settings?.speed ?? 1)));
    }
    send(404, { detail: 'Not Found' });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function speak(text: string, speed: number) {
  const per = MS_PER_CHAR / speed;
  const characters = [...text];
  const starts = characters.map((_, i) => (LEAD_MS + i * per) / 1000);
  const ends = characters.map((_, i) => (LEAD_MS + (i + 1) * per) / 1000);
  const totalMs = LEAD_MS * 2 + characters.length * per;
  const samples = Math.round((totalMs / 1000) * RATE);
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * 8000), i * 2);
  const alignment = { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
  return { audio_base64: pcm.toString('base64'), alignment, normalized_alignment: alignment };
}
