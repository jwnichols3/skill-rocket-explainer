import { createHash } from 'node:crypto';
import { mkdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { sendFile } from '../server.ts';
import { TTS_PROVIDERS } from '../providers/registry.ts';
import { parseVoice } from './styles.ts';

const PREVIEW_LINE = 'Hi there. This is how your explainers will sound in this voice.';

export function coreRoutes(app: App, router: Router) {
  router.get('/api/jobs', ({ url }) => app.jobs.list({ target: url.searchParams.get('target') ?? undefined, active: url.searchParams.get('active') === '1' }));
  router.get('/api/jobs/:id', ({ params }) => {
    const job = app.jobs.get(params.id);
    if (!job) throw new HttpError(404, 'no such job');
    return job;
  });
  router.post('/api/jobs/:id/cancel', ({ params }) => ({ cancelled: app.jobs.cancel(params.id) }));

  router.get('/api/tts/:provider/voices', ({ params }) => app.providers.tts(params.provider).voices());
  router.get('/api/tts/:provider/voices/:voice/capabilities', ({ params }) => app.providers.tts(params.provider).capabilities(params.voice));

  // Voice preview: a short fixed line, cached per provider/voice/controls under <home>/cache/tts-preview.
  const previewDir = join(app.paths.home, 'cache', 'tts-preview');
  router.post('/api/tts/preview', async ({ body }) => {
    const v = parseVoice(app, body);
    if (!TTS_PROVIDERS[v.provider]) throw new HttpError(400, `unknown TTS provider "${v.provider}"`);
    const key = createHash('sha256').update(JSON.stringify([v.provider, v.voiceId, v.controls, PREVIEW_LINE])).digest('hex').slice(0, 32);
    const file = join(previewDir, `${key}.wav`);
    if (!(await stat(file).catch(() => null))) {
      await mkdir(previewDir, { recursive: true });
      const tmp = join(previewDir, `${key}.${crypto.randomUUID().slice(0, 8)}.tmp.wav`);
      await app.providers.tts(v.provider).synthesize(PREVIEW_LINE, v.voiceId, v.controls, tmp);
      await rename(tmp, file);
    }
    return { url: `/media/tts-preview/${key}.wav` };
  });
  // Registered before /media/* so only preview files are reachable here, not the cache dir at large.
  router.get('/media/tts-preview/:file', async ({ req, res, params }) => {
    if (!/^[0-9a-f]{32}\.wav$/.test(params.file)) throw new HttpError(404, 'not found');
    await sendFile(req, res, previewDir, params.file);
  });

  // Media from the data dir: styles and explainers only (never settings or secrets).
  router.get('/media/*', async ({ req, res, params, url }) => {
    const rel = params.rest;
    if (!/^(styles|explainers)\//.test(rel)) throw new HttpError(403, 'not a media path');
    await sendFile(req, res, app.paths.home, rel, url.searchParams.get('download') ?? undefined);
  });
}
