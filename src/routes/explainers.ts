import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { OUTPUT_TYPES, type OutputType } from '../settings.ts';
import { normalizeSources, type Explainer, type Comment } from '../explainer/store.ts';
import { newId } from '../lock.ts';
import { runSourceReport, runPlan, expandHome } from '../pipeline/explainer-prep.ts';
import { runBuild } from '../pipeline/build.ts';
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

  router.get('/api/explainers/:id', async ({ params }) => withUrls(await store.get(params.id)));

  router.put('/api/explainers/:id', async ({ params, body }) => {
    const current = await store.get(params.id);
    const c = await choices(body ?? {}, current);
    return withUrls(await store.update(params.id, (e) => { Object.assign(e, c); }));
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
    return withUrls(await store.update(params.id, (x) => { x.approvedPlan = latest.n; if (x.status !== 'built') x.status = 'approved'; }));
  });
}

/** Adds media URLs to an explainer's output rounds. */
export function withUrls(e: Explainer) {
  const outputs: Record<string, unknown> = {};
  for (const [type, state] of Object.entries(e.outputs ?? {})) {
    if (!state) continue;
    outputs[type] = {
      ...state,
      rounds: state.rounds.map((r) => {
        const base = `/media/explainers/${e.id}/outputs/${type}/rounds/${r.n}`;
        return { ...r, url: `${base}/${r.files[0]}`, fileUrls: r.files.map((f) => `${base}/${f}`) };
      }),
    };
  }
  return { ...e, outputs };
}

export function outputRoutes(app: App, router: Router) {
  const store = app.explainers;
  const type = (t: string): OutputType => {
    if (!OUTPUT_TYPES.includes(t as OutputType)) throw new HttpError(400, `unknown output type "${t}"`);
    return t as OutputType;
  };

  router.post('/api/explainers/:id/outputs/:type/build', async ({ params }) => {
    const t = type(params.type);
    const e = await store.get(params.id);
    if (!e.approvedPlan) throw new HttpError(400, 'approve a plan first');
    if (!e.styleId) throw new HttpError(400, 'pick a style first');
    app.providers.renderer(t);
    return startJob(app, `build-${t}`, `explainer:${params.id}`, (ctx) => runBuild(app, params.id, t, 'build', ctx));
  });

  router.post('/api/explainers/:id/outputs/:type/rerender', async ({ params }) => {
    const t = type(params.type);
    const e = await store.get(params.id);
    if (!e.outputs[t]?.current) throw new HttpError(400, `build the ${t} first`);
    return startJob(app, `rerender-${t}`, `explainer:${params.id}`, (ctx) => runBuild(app, params.id, t, 'rerender', ctx));
  });

  router.post('/api/explainers/:id/outputs/:type/rounds/:n/comments', async ({ params, body }) => {
    const t = type(params.type);
    if (typeof body?.text !== 'string' || !body.text.trim()) throw new HttpError(400, 'comment text is required');
    const c: Comment = { id: newId('c_'), text: body.text.trim(), createdAt: new Date().toISOString() };
    if (typeof body.atMs === 'number' && body.atMs >= 0) c.atMs = Math.round(body.atMs);
    if (typeof body.sceneId === 'string' && body.sceneId) c.sceneId = body.sceneId;
    await store.update(params.id, (e) => {
      const r = e.outputs[t]?.rounds.find((x) => x.n === Number(params.n));
      if (!r) throw new HttpError(404, `no ${t} round ${params.n}`);
      if (c.sceneId && !r.scenes.some((s) => s.id === c.sceneId)) throw new HttpError(400, `no scene ${c.sceneId}`);
      r.comments.push(c);
    });
    return c;
  });

  router.del('/api/explainers/:id/outputs/:type/rounds/:n/comments/:cid', async ({ params }) => {
    const t = type(params.type);
    await store.update(params.id, (e) => {
      const r = e.outputs[t]?.rounds.find((x) => x.n === Number(params.n));
      if (r) r.comments = r.comments.filter((c) => c.id !== params.cid);
    });
    return { ok: true };
  });

  router.post('/api/explainers/:id/outputs/:type/current', async ({ params, body }) => {
    const t = type(params.type);
    if (app.jobs.active(`explainer:${params.id}`)) throw new HttpError(409, 'wait for the running job to finish');
    return withUrls(await store.update(params.id, (e) => {
      const state = e.outputs[t];
      const r = state?.rounds.find((x) => x.n === Number(body?.round));
      if (!state || !r) throw new HttpError(404, `no ${t} round ${body?.round}`);
      state.current = r.n;
      state.script = r.scenes.map(({ startMs, durationMs, ...s }) => s);
    }));
  });

  // Hand edits to the script (narration and visuals). Scene ids and order are fixed.
  router.put('/api/explainers/:id/outputs/:type/script', async ({ params, body }) => {
    const t = type(params.type);
    if (!Array.isArray(body?.scenes)) throw new HttpError(400, 'expected { scenes }');
    return withUrls(await store.update(params.id, (e) => {
      const state = e.outputs[t];
      if (!state) throw new HttpError(400, `build the ${t} first`);
      state.script = state.script.map((s) => {
        const edit = body.scenes.find((x: any) => x?.id === s.id);
        return edit ? { ...s, narration: typeof edit.narration === 'string' ? edit.narration : s.narration, visuals: typeof edit.visuals === 'string' ? edit.visuals : s.visuals } : s;
      });
    }));
  });

  router.post('/api/explainers/:id/outputs/:type/export', async ({ params, body }) => {
    const t = type(params.type);
    if (typeof body?.path !== 'string' || !body.path.trim()) throw new HttpError(400, 'path is required');
    const e = await store.get(params.id);
    const state = e.outputs[t];
    const r = state?.rounds.find((x) => x.n === state.current);
    if (!r) throw new HttpError(400, `build the ${t} first`);
    const files = await exportFiles(store.roundDir(params.id, t, r.n), r.files, body.path.trim(), e.title || `explainer-${t}`);
    return { files };
  });
}

/** Copies output files to a user path: a directory (trailing slash or existing dir) or a file name for the primary. */
async function exportFiles(dir: string, files: string[], target: string, title: string): Promise<string[]> {
  const { mkdir, copyFile, stat } = await import('node:fs/promises');
  const { join, extname, dirname, resolve } = await import('node:path');
  const dest = resolve(expandHome(target));
  const isDir = /[\\/]$/.test(target) || (await stat(dest).then((s) => s.isDirectory(), () => false));
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'explainer';
  const out: string[] = [];
  for (const [i, f] of files.entries()) {
    const to = isDir ? join(dest, `${slug}${extname(f)}`) : i === 0 ? dest : join(dirname(dest), `${slug}${extname(f)}`);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(dir, f), to);
    out.push(to);
  }
  return out;
}
