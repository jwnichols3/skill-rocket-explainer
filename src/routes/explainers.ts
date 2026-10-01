import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { OUTPUT_TYPES, type OutputType } from '../settings.ts';
import { normalizeSources, type Explainer } from '../explainer/store.ts';
import { newId } from '../lock.ts';
import { runSourceReport, runPlan } from '../pipeline/explainer-prep.ts';
import { pickModel, startJob } from './styles.ts';
import { AGENT_SURFACES } from '../providers/registry.ts';

export function explainerRoutes(app: App, router: Router) {
  const store = app.explainers;

  async function choices(body: any, current?: Explainer): Promise<Partial<Explainer>> {
    const out: Partial<Explainer> = {};
    if (body.styleId !== undefined) {
      if (body.styleId !== null && !(await app.styles.exists(String(body.styleId)).catch(() => false))) throw new HttpError(400, `unknown style "${body.styleId}"`);
      out.styleId = body.styleId;
    }
    if (body.outputType !== undefined) {
      if (!OUTPUT_TYPES.includes(body.outputType)) throw new HttpError(400, `unknown output type "${body.outputType}" (one of ${OUTPUT_TYPES.join(', ')})`);
      out.outputType = body.outputType as OutputType;
    }
    if (body.model !== undefined || body.effort !== undefined) Object.assign(out, pickModel(app, { model: current?.model, effort: current?.effort, ...body }));
    if (body.surface !== undefined) {
      if (!AGENT_SURFACES[body.surface]) throw new HttpError(400, `unknown agent surface "${body.surface}"`);
      out.surface = body.surface;
    }
    if (typeof body.title === 'string') out.title = body.title.trim();
    if (typeof body.brief === 'string') out.brief = body.brief.trim();
    if (body.sources !== undefined) out.sources = normalizeSources(body.sources);
    return out;
  }

  router.get('/api/explainers', () => store.list());

  router.post('/api/explainers', async ({ body }) => {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'expected an explainer');
    const c = await choices(body);
    if (!c.brief && !c.sources?.length) throw new HttpError(400, 'say what to explain, or add a source');
    const s = app.settings();
    return store.create({
      title: c.title ?? '', brief: c.brief ?? '', sources: c.sources ?? [], styleId: c.styleId ?? null,
      outputType: c.outputType ?? 'video', model: c.model ?? s.defaults.model, effort: c.effort ?? s.defaults.effort,
      surface: c.surface ?? s.providers.agent,
    });
  });

  router.get('/api/explainers/:id', ({ params }) => store.get(params.id));

  router.put('/api/explainers/:id', async ({ params, body }) => {
    const current = await store.get(params.id);
    const c = await choices(body ?? {}, current);
    return store.update(params.id, (e) => { Object.assign(e, c); });
  });

  router.del('/api/explainers/:id', async ({ params }) => {
    if (app.jobs.active(`explainer:${params.id}`)) throw new HttpError(409, 'wait for the running job to finish');
    await store.delete(params.id);
    return { ok: true };
  });

  router.post('/api/explainers/:id/corrections', async ({ params, body }) => {
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'correction text is required');
    const c = { id: newId('c_'), text: body.text.trim(), createdAt: new Date().toISOString() };
    await store.update(params.id, (e) => { e.corrections.push(c); });
    return c;
  });

  router.del('/api/explainers/:id/corrections/:cid', async ({ params }) => {
    await store.update(params.id, (e) => { e.corrections = e.corrections.filter((c) => c.id !== params.cid); });
    return { ok: true };
  });

  router.post('/api/explainers/:id/report', async ({ params }) => {
    const e = await store.get(params.id);
    if (!e.sources.some((s) => s.enabled) && !e.brief) throw new HttpError(400, 'add a source first');
    return startJob(app, 'source-report', `explainer:${params.id}`, (ctx) => runSourceReport(app, params.id, ctx));
  });

  router.post('/api/explainers/:id/plan', async ({ params }) => {
    const e = await store.get(params.id);
    if (!e.report) throw new HttpError(400, 'run the source report first');
    if (!e.styleId) throw new HttpError(400, 'pick a style first');
    return startJob(app, 'plan', `explainer:${params.id}`, (ctx) => runPlan(app, params.id, ctx));
  });

  router.post('/api/explainers/:id/plans/:n/comments', async ({ params, body }) => {
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'comment text is required');
    const c = { id: newId('c_'), text: body.text.trim(), createdAt: new Date().toISOString() };
    await store.update(params.id, (e) => {
      const p = e.plans.find((x) => x.n === Number(params.n));
      if (!p) throw new HttpError(404, `no plan ${params.n}`);
      p.comments.push(c);
    });
    return c;
  });

  router.del('/api/explainers/:id/plans/:n/comments/:cid', async ({ params }) => {
    await store.update(params.id, (e) => {
      const p = e.plans.find((x) => x.n === Number(params.n));
      if (p) p.comments = p.comments.filter((c) => c.id !== params.cid);
    });
    return { ok: true };
  });

  router.post('/api/explainers/:id/approve', async ({ params }) => {
    const e = await store.get(params.id);
    const latest = e.plans.at(-1);
    if (!latest) throw new HttpError(400, 'there is no plan to approve yet');
    return store.update(params.id, (x) => { x.approvedPlan = latest.n; x.status = 'approved'; });
  });
}
