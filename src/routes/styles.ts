import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { ConflictError } from '../jobs.ts';
import { runStyleSample } from '../pipeline/style-sample.ts';
import type { VoiceChoice } from '../style/store.ts';

export function parseVoice(app: App, v: any): VoiceChoice {
  const provider = typeof v?.provider === 'string' ? v.provider : app.settings().providers.tts;
  if (typeof v?.voiceId !== 'string' || !v.voiceId) throw new HttpError(400, 'voice.voiceId is required');
  const controls: Record<string, unknown> = {};
  for (const k of ['rate', 'pitch', 'volume']) if (typeof v.controls?.[k] === 'number') controls[k] = v.controls[k];
  if (typeof v.controls?.style === 'string' && v.controls.style) controls.style = v.controls.style;
  return { provider, voiceId: v.voiceId, controls };
}

export function pickModel(app: App, body: any): { model: string; effort: string } {
  const s = app.settings();
  const model = typeof body?.model === 'string' && body.model ? body.model : s.defaults.model;
  const effort = typeof body?.effort === 'string' && body.effort ? body.effort : s.defaults.effort;
  if (!s.efforts.includes(effort)) throw new HttpError(400, `unknown effort "${effort}"`);
  return { model, effort };
}

export function startJob(app: App, kind: string, target: string, fn: Parameters<App['jobs']['start']>[2]) {
  try {
    return app.jobs.start(kind, target, fn);
  } catch (err) {
    if (err instanceof ConflictError) throw new HttpError(409, err.message);
    throw err;
  }
}

export function styleRoutes(app: App, router: Router) {
  const store = app.styles;

  router.get('/api/styles', () => store.list());

  router.post('/api/styles', async ({ body }) => {
    if (typeof body?.description !== 'string' || !body.description.trim()) throw new HttpError(400, 'description is required');
    const voice = parseVoice(app, body.voice);
    const { model, effort } = pickModel(app, body);
    return store.create({ name: body.name ?? null, description: body.description.trim(), voice, model, effort });
  });

  router.get('/api/styles/:id', ({ params }) => store.get(params.id));

  router.post('/api/styles/:id/sample', async ({ params }) => {
    await store.meta(params.id);
    return startJob(app, 'style-sample', `style:${params.id}`, (ctx) => runStyleSample(app, params.id, ctx, { comments: [], priorComments: [], basedOn: null }));
  });
}
