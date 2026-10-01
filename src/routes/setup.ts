import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { runChecks } from '../doctor.ts';
import { validateProviders } from '../providers/registry.ts';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { versions } from '../diagnostics.ts';
import { sendFile } from '../server.ts';

/** Normalizes a reverse-proxy URL; returns its host for the allowlist. */
export function parsePublicUrl(v: unknown): { url: string; host: string } | null {
  if (v === undefined || v === null || v === '') return null;
  let u: URL;
  try { u = new URL(String(v)); } catch { throw new HttpError(400, `not a URL: ${v}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, 'the public URL must be http(s)');
  return { url: `${u.protocol}//${u.host}`, host: u.host.toLowerCase() };
}

export function setupRoutes(app: App, router: Router) {
  router.get('/api/doctor', async () => runChecks(app.settings(), app.paths));

  // Diagnostics page: the doctor checks, versions, and where things live.
  router.get('/api/diagnostics', async () => ({
    checks: await runChecks(app.settings(), app.paths),
    versions: await versions(),
    dataDir: app.paths.home,
    providers: app.settings().providers,
  }));

  // A job's log as a text download.
  router.get('/api/jobs/:id/log', ({ res, params }) => {
    const job = app.jobs.get(params.id);
    if (!job) throw new HttpError(404, 'no such job');
    const head = `${job.kind} ${job.target} ${job.status}\ncreated ${job.createdAt}  started ${job.startedAt ?? '-'}  ended ${job.endedAt ?? '-'}\n${job.error ? `error: ${job.error}\n` : ''}\n`;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${job.id}.log"`, 'cache-control': 'no-store' });
    res.end(head + job.log.join('\n') + '\n');
  });

  // App and server logs in the data dir's logs folder.
  router.get('/api/logs', async () => {
    const names = await readdir(app.paths.logs).catch(() => [] as string[]);
    return Promise.all(names.filter((n) => n.endsWith('.log')).map(async (name) => {
      const st = await stat(join(app.paths.logs, name));
      return { name, size: st.size, updatedAt: st.mtime.toISOString() };
    }));
  });
  router.get('/api/logs/:name', async ({ req, res, params }) => {
    if (!/^[\w.-]+\.log$/.test(params.name)) throw new HttpError(400, 'not a log name');
    await sendFile(req, res, app.paths.logs, params.name, params.name);
  });

  router.get('/api/setup', async () => ({
    complete: !!app.settings().setupComplete,
    settings: app.settings(),
    checks: await runChecks(app.settings(), app.paths),
  }));

  // First-run choices. Safe to re-run: only what is sent changes.
  router.post('/api/setup', async ({ body }) => {
    const patch: Record<string, unknown> = { setupComplete: true };
    if (body && 'publicUrl' in body) {
      const pub = parsePublicUrl(body.publicUrl);
      patch.publicUrl = pub?.url ?? '';
      patch.publicHostnames = pub ? [pub.host] : [];
    }
    if (body?.providers) {
      const bad = validateProviders(body.providers);
      if (bad) throw new HttpError(400, bad);
      patch.providers = body.providers;
    }
    for (const k of ['polly', 'bedrock'] as const) if (body?.[k]) patch[k] = body[k];
    const settings = await app.updateSettings(patch);
    return { complete: true, settings, checks: await runChecks(settings, app.paths) };
  });
}
