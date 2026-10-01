import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { AGENT_SURFACES, TTS_PROVIDERS, RENDERERS } from '../providers/registry.ts';
import { setSecret, secretStatus } from '../secrets.ts';

/** Secret names a provider id declares (Factory.secrets) across the provider tables. */
function declared(provider: string): string[] {
  const tables = [AGENT_SURFACES, TTS_PROVIDERS, RENDERERS] as Record<string, { secrets?: string[] }>[];
  return [...new Set(tables.flatMap((t) => (Object.hasOwn(t, provider) ? t[provider].secrets ?? [] : [])))];
}

/** Provider API keys. Responses only ever say which keys are set, never their values. */
export function secretRoutes(app: App, router: Router) {
  router.get('/api/secrets', () => secretStatus(app.paths));

  // PUT { apiKey: '...' } sets, { apiKey: '' } deletes.
  router.put('/api/secrets/:provider', async ({ params, body }) => {
    const names = declared(params.provider);
    if (!names.length) throw new HttpError(404, `provider "${params.provider}" takes no secrets`);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, `expected { ${names.join(', ')} }`);
    const entries = Object.entries(body);
    if (!entries.length) throw new HttpError(400, `expected { ${names.join(', ')} }`);
    for (const [k, v] of entries) {
      if (!names.includes(k)) throw new HttpError(400, `unknown secret "${k}" for ${params.provider} (expected ${names.join(', ')})`);
      if (typeof v !== 'string') throw new HttpError(400, `${k} must be a string`);
    }
    for (const [k, v] of entries) await setSecret(app.paths, params.provider, k, (v as string).trim());
    app.providers.reset();
    app.log('info', `secrets updated for ${params.provider}: ${entries.map(([k, v]) => `${k} ${v ? 'set' : 'cleared'}`).join(', ')}`);
    return (await secretStatus(app.paths))[params.provider] ?? {};
  });
}
