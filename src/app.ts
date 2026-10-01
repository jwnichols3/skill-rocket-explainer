import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from './datadir.ts';
import { loadSettings, saveSettings, type Settings } from './settings.ts';
import { Router, HttpError } from './router.ts';
import { Providers, validateProviders, AGENT_SURFACES, TTS_PROVIDERS, RENDERERS } from './providers/registry.ts';
import { VERSION } from './version.ts';
import { JobRunner } from './jobs.ts';
import { StyleStore } from './style/store.ts';
import { coreRoutes } from './routes/core.ts';
import { seedStyles } from './style/seed.ts';
import { secretRoutes } from './routes/secrets.ts';
import { styleRoutes } from './routes/styles.ts';
import { explainerRoutes, outputRoutes } from './routes/explainers.ts';
import { ExplainerStore } from './explainer/store.ts';
import './providers/fake/responders.ts';

export interface App {
  paths: Paths;
  settings(): Settings;
  providers: Providers;
  jobs: JobRunner;
  styles: StyleStore;
  explainers: ExplainerStore;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
  onSettingsChanged(fn: (s: Settings) => void): void;
  shutdown(): Promise<void>;
}

export async function createApp(paths: Paths, router: Router): Promise<App> {
  let settings = await loadSettings(paths);
  const listeners: ((s: Settings) => void)[] = [];
  const providers = new Providers({ paths, settings: () => settings });
  const logFile = join(paths.logs, 'app.log');
  const log = (level: string, msg: string) => { appendFile(logFile, `${new Date().toISOString()} ${level.toUpperCase()} ${msg}\n`).catch(() => {}); };
  const jobs = new JobRunner(paths, (msg) => log('error', msg));
  await jobs.init();

  const app: App = {
    paths,
    settings: () => settings,
    providers,
    jobs,
    styles: new StyleStore(paths),
    explainers: new ExplainerStore(paths),
    log,
    onSettingsChanged(fn) { listeners.push(fn); },
    async shutdown() { await jobs.shutdown(); },
  };
  settings = await seedStyles(paths, settings, app.styles, providers);
  coreRoutes(app, router);
  secretRoutes(app, router);
  styleRoutes(app, router);
  explainerRoutes(app, router);
  outputRoutes(app, router);

  router.get('/api/status', () => ({
    app: 'rocket-explainer',
    version: VERSION,
    home: paths.home,
    providers: settings.providers,
  }));

  router.get('/api/settings', () => ({
    settings,
    available: {
      agent: Object.entries(AGENT_SURFACES).map(([id, f]) => ({ id, label: f.label })),
      tts: Object.entries(TTS_PROVIDERS).map(([id, f]) => ({ id, label: f.label, secrets: f.secrets ?? [] })),
      renderer: Object.entries(RENDERERS).map(([id, f]) => ({ id, label: f.label, outputTypes: f.outputTypes })),
    },
  }));

  router.put('/api/settings', async ({ body }) => {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a settings object');
    if (/"apiKey"\s*:/i.test(JSON.stringify(body))) throw new HttpError(400, 'API keys are not settings: use PUT /api/secrets/:provider');
    const bad = validateProviders(body.providers);
    if (bad) throw new HttpError(400, bad);
    settings = await saveSettings(paths, body);
    providers.reset();
    for (const fn of listeners) fn(settings);
    return { settings };
  });

  return app;
}
