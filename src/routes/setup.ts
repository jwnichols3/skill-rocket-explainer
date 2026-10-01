import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { runChecks } from '../doctor.ts';
import { validateProviders } from '../providers/registry.ts';

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
