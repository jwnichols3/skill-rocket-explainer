import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { sendFile } from '../server.ts';

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

  // Media from the data dir: styles and explainers only (never settings or secrets).
  router.get('/media/*', async ({ req, res, params, url }) => {
    const [area, ...rest] = params.rest.split('/');
    const root = area === 'styles' ? app.paths.styles : area === 'explainers' ? app.paths.explainers : null;
    if (!root) throw new HttpError(403, 'not a media path');
    // sendFile confines the resolved path to the area root, so ../ can't reach settings or secrets.
    await sendFile(req, res, root, rest.join('/'), url.searchParams.get('download') ?? undefined);
  });
}
