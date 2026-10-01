import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { ConflictError } from '../jobs.ts';
import { runStyleSample } from '../pipeline/style-sample.ts';
import type { VoiceChoice } from '../style/store.ts';
import { readdir } from 'node:fs/promises';
import { OUTPUT_TYPES, type OutputType } from '../settings.ts';
import { join } from 'node:path';
import { readJson } from '../datadir.ts';
import { styleNamesPrompt } from '../prompts/style.ts';

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

  // A first sample, or an on-demand sample of another output type (deck, doc, visual).
  router.post('/api/styles/:id/sample', async ({ params, body }) => {
    const meta = await store.meta(params.id);
    const outputType = (body?.outputType ?? 'video') as OutputType;
    if (!OUTPUT_TYPES.includes(outputType)) throw new HttpError(400, `unknown output type "${outputType}"`);
    app.providers.renderer(outputType);
    return startJob(app, `style-sample-${outputType}`, `style:${params.id}`, (ctx) => runStyleSample(app, params.id, ctx, { comments: [], basedOn: meta.currentRound, outputType }));
  });

  // Voice, model, effort and description changes apply to the next round.
  router.put('/api/styles/:id', async ({ params, body }) => {
    const patch: Record<string, unknown> = {};
    if (body?.voice) patch.voice = parseVoice(app, body.voice);
    if (body?.model || body?.effort) Object.assign(patch, pickModel(app, { ...(await store.meta(params.id)), ...body }));
    if (typeof body?.description === 'string' && body.description.trim()) patch.description = body.description.trim();
    await store.update(params.id, (m) => { Object.assign(m, patch); });
    return store.get(params.id);
  });

  router.post('/api/styles/:id/rounds/:n/comments', async ({ params, body }) => {
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'comment text is required');
    const atMs = typeof body.atMs === 'number' && body.atMs >= 0 ? Math.round(body.atMs) : undefined;
    return store.addComment(params.id, Number(params.n), body.text.trim(), atMs);
  });

  router.del('/api/styles/:id/rounds/:n/comments/:cid', async ({ params }) => {
    await store.removeComment(params.id, Number(params.n), params.cid);
    return { ok: true };
  });

  // Next round: the current round's comments refine the current instructions.
  router.post('/api/styles/:id/rerender', async ({ params, body }) => {
    const meta = await store.meta(params.id);
    if (body?.voice || body?.model || body?.effort) {
      const patch: Record<string, unknown> = {};
      if (body.voice) patch.voice = parseVoice(app, body.voice);
      if (body.model || body.effort) Object.assign(patch, pickModel(app, { ...meta, ...body }));
      await store.update(params.id, (m) => { Object.assign(m, patch); });
    }
    const current = meta.currentRound ? (await store.rounds(params.id)).find((r) => r.n === meta.currentRound) : undefined;
    return startJob(app, 'style-sample', `style:${params.id}`, (ctx) =>
      runStyleSample(app, params.id, ctx, { comments: current?.comments ?? [], basedOn: current?.n ?? null, outputType: current?.outputType ?? 'video' }));
  });

  router.post('/api/styles/:id/revert', async ({ params, body }) => {
    if (app.jobs.active(`style:${params.id}`)) throw new HttpError(409, 'wait for the running job to finish');
    await store.revert(params.id, Number(body?.round));
    return store.get(params.id);
  });

  router.post('/api/styles/:id/name-suggestions', async ({ params }) => {
    const meta = await store.meta(params.id);
    const res = await app.providers.agent().run({
      kind: 'style-names', prompt: styleNamesPrompt(),
      inputs: { description: meta.description, design: await store.design(params.id) }, resultFile: 'result.json',
    }, { workdir: join(app.paths.home, 'work', `names-${params.id}-${Date.now()}`), model: meta.model, effort: 'low' });
    if (!res.ok) throw new HttpError(502, `name suggestions failed: ${res.error.message}`);
    const names = (Array.isArray(res.output?.names) ? res.output.names : []).filter((n: unknown) => typeof n === 'string' && n.trim()).slice(0, 3);
    if (names.length < 2) throw new HttpError(502, 'the agent did not suggest enough names');
    return { names };
  });

  router.post('/api/styles/:id/save', async ({ params, body }) => {
    const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : (await store.meta(params.id)).name;
    if (!name) throw new HttpError(400, 'a name is required to save');
    await store.update(params.id, (m) => { m.name = name; m.savedAt = new Date().toISOString(); });
    return store.get(params.id);
  });

  router.post('/api/styles/:id/clone', async ({ params, body }) => {
    const copy = await store.clone(params.id, body?.name);
    return store.get(copy.id);
  });

  router.del('/api/styles/:id', async ({ params, url }) => {
    await store.meta(params.id);
    if (app.jobs.active(`style:${params.id}`)) throw new HttpError(409, 'wait for the running job to finish');
    const usedBy = await explainersUsingStyle(app, params.id);
    if (usedBy.length && url.searchParams.get('force') !== '1') {
      throw new HttpError(409, `${usedBy.length} explainer(s) use this style`, { usedBy });
    }
    await store.delete(params.id);
    return { ok: true };
  });
}

/** Explainers whose explainer.json names this style. */
export async function explainersUsingStyle(app: App, styleId: string): Promise<{ id: string; title: string }[]> {
  let ids: string[] = [];
  try { ids = await readdir(app.paths.explainers); } catch {}
  const out = [];
  for (const id of ids) {
    const e = await readJson<any>(join(app.paths.explainers, id, 'explainer.json'), null);
    if (e?.styleId === styleId) out.push({ id: e.id, title: e.title });
  }
  return out;
}
