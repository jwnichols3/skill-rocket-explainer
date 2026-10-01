import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { stat } from 'node:fs/promises';
import type { App } from '../app.ts';
import type { JobCtx } from '../jobs.ts';
import type { SourceReport, Plan } from '../explainer/store.ts';
import { sourceReportPrompt, planPrompt } from '../prompts/explainer.ts';

export const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);

/** Agent surface for an explainer: its own choice, falling back to the default. */
export function surfaceFor(app: App, surface: string | undefined) {
  return app.providers.agent(surface || undefined);
}

/** Gather sources and write the source report. */
export async function runSourceReport(app: App, id: string, ctx: JobCtx) {
  const e = await app.explainers.get(id);
  const sources = e.sources.filter((s) => s.enabled).map((s) => ({ ...s, value: s.kind === 'path' ? resolve(expandHome(s.value)) : s.value }));
  // Folders the agent may read: each path source (or its parent dir for files).
  const readDirs: string[] = [];
  for (const s of sources.filter((s) => s.kind === 'path')) {
    try { readDirs.push((await stat(s.value)).isDirectory() ? s.value : resolve(s.value, '..')); } catch {}
  }
  ctx.stage('Gathering sources', 0.1, `${sources.length} source${sources.length === 1 ? '' : 's'}`);
  const res = await surfaceFor(app, e.surface).run({
    kind: 'source-report',
    prompt: sourceReportPrompt(),
    inputs: { brief: e.brief, sources: sources.map(({ id, kind, value }) => ({ id, kind, value })), corrections: e.corrections.map((c) => c.text) },
    resultFile: 'result.json',
    readDirs,
    tools: ['Read', 'Glob', 'Grep', 'Write', 'WebFetch'],
  }, { workdir: join(app.paths.home, 'work', ctx.id), model: e.model, effort: e.effort, signal: ctx.signal, onLog: ctx.log });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  const out = res.output ?? {};
  if (!Array.isArray(out.sources)) throw new Error('the report has no sources list');
  const report: SourceReport = {
    overall: String(out.overall ?? ''),
    sources: sources.map((s) => {
      const f = out.sources.find((x: any) => x?.sourceId === s.id) ?? {};
      return { sourceId: s.id, found: f.found === true, summary: String(f.summary ?? ''), extract: String(f.extract ?? ''), ...(f.notes ? { notes: String(f.notes) } : {}) };
    }),
    gaps: Array.isArray(out.gaps) ? out.gaps.map(String) : [],
    ...(out.suggestedTitle ? { suggestedTitle: String(out.suggestedTitle) } : {}),
    createdAt: new Date().toISOString(),
  };
  await app.explainers.update(id, (x) => {
    x.report = report;
    if (!x.title && report.suggestedTitle) x.title = report.suggestedTitle;
    if (x.status === 'draft') x.status = 'reported';
  });
  ctx.log(`report: ${report.sources.filter((s) => s.found).length}/${report.sources.length} sources found`);
}

export function validatePlan(p: any): string[] {
  const problems: string[] = [];
  if (!p || typeof p !== 'object') return ['plan is missing'];
  for (const k of ['title', 'summary', 'length']) if (typeof p[k] !== 'string' || !p[k].trim()) problems.push(`plan lacks ${k}`);
  if (!Array.isArray(p.outline) || !p.outline.length) problems.push('plan lacks an outline');
  if (!Array.isArray(p.keyVisuals) || !p.keyVisuals.length) problems.push('plan lacks key visuals');
  if (!Array.isArray(p.scenes) || !p.scenes.length) problems.push('plan lacks scenes');
  else {
    const ids = new Set();
    for (const [i, s] of p.scenes.entries()) {
      if (!s?.id || !s?.title || !s?.visuals) problems.push(`scene ${i} lacks id/title/visuals`);
      if (ids.has(s?.id)) problems.push(`duplicate scene id ${s?.id}`);
      ids.add(s?.id);
    }
  }
  return problems;
}

/** Propose (or revise) the plan. */
export async function runPlan(app: App, id: string, ctx: JobCtx) {
  const e = await app.explainers.get(id);
  if (!e.report) throw new Error('run the source report first');
  if (!e.styleId) throw new Error('pick a style first');
  const style = await app.styles.design(e.styleId);
  const previous = e.plans.at(-1);
  ctx.stage(previous ? 'Revising the plan' : 'Planning', 0.1, `${e.model} · ${e.effort}`);
  const res = await surfaceFor(app, e.surface).run({
    kind: 'explainer-plan',
    prompt: planPrompt(e.outputType),
    inputs: {
      brief: e.brief, outputType: e.outputType, report: e.report, corrections: e.corrections.map((c) => c.text), style,
      previousPlan: previous?.plan ?? null, comments: previous?.comments.map((c) => c.text) ?? [],
    },
    resultFile: 'result.json',
  }, { workdir: join(app.paths.home, 'work', ctx.id), model: e.model, effort: e.effort, signal: ctx.signal, onLog: ctx.log });
  if (!res.ok) throw new Error(`agent failed (${res.error.kind}): ${res.error.message}`);
  const problems = validatePlan(res.output);
  if (problems.length) throw new Error(`the plan is invalid: ${problems.join('; ')}`);
  const plan = res.output as Plan;
  await app.explainers.update(id, (x) => {
    x.plans.push({ n: (x.plans.at(-1)?.n ?? 0) + 1, plan, comments: [], createdAt: new Date().toISOString(), model: e.model, effort: e.effort });
    x.status = 'planned';
    x.approvedPlan = null;
  });
}
