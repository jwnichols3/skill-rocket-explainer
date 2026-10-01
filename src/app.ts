import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Paths } from './datadir.ts';
import { loadSettings, saveSettings, merge, validateSettings, type Settings } from './settings.ts';
import { Router, HttpError } from './router.ts';
import { Providers, validateProviders, AGENT_SURFACES, TTS_PROVIDERS, RENDERERS } from './providers/registry.ts';
import { VERSION } from './version.ts';
import { JobRunner } from './jobs.ts';
import { StyleStore } from './style/store.ts';
import { coreRoutes } from './routes/core.ts';
import { styleRoutes } from './routes/styles.ts';
import { explainerRoutes, outputRoutes } from './routes/explainers.ts';
import { bedrockRoutes } from './routes/bedrock.ts';
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
  coreRoutes(app, router);
  styleRoutes(app, router);
  explainerRoutes(app, router);
  outputRoutes(app, router);
  bedrockRoutes(app, router);

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
      tts: Object.entries(TTS_PROVIDERS).map(([id, f]) => ({ id, label: f.label })),
      renderer: Object.entries(RENDERERS).map(([id, f]) => ({ id, label: f.label, outputTypes: f.outputTypes })),
    },
  }));

  router.put('/api/settings', async ({ body }) => {
    if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a settings object');
    const bad = validateProviders(body.providers);
    if (bad) throw new HttpError(400, bad);
    const invalid = validateSettings(merge(settings, body));
    if (invalid) throw new HttpError(400, invalid);
    settings = await saveSettings(paths, body);
    providers.reset();
    for (const fn of listeners) fn(settings);
    return { settings };
  });

  return app;
}
