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
import { setupRoutes } from './routes/setup.ts';
import { seedStyles } from './style/seed.ts';
import { secretRoutes } from './routes/secrets.ts';
import { styleRoutes } from './routes/styles.ts';
import { explainerRoutes, outputRoutes } from './routes/explainers.ts';
import { bedrockRoutes } from './routes/bedrock.ts';
import { updateRoutes } from './routes/update.ts';
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
  /** Saves a settings patch and tells providers and listeners (e.g. the Host allowlist). */
  updateSettings(patch: unknown): Promise<Settings>;
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
    async updateSettings(patch) {
      const bad = validateProviders((patch as any)?.providers) ?? validateSettings(merge(settings, patch));
      if (bad) throw new HttpError(400, bad);
      settings = await saveSettings(paths, patch);
      providers.reset();
      for (const fn of listeners) fn(settings);
      return settings;
    },
    async shutdown() { await jobs.shutdown(); },
  };
  settings = await seedStyles(paths, settings, app.styles, providers);
  coreRoutes(app, router);
  secretRoutes(app, router);
  styleRoutes(app, router);
  explainerRoutes(app, router);
  setupRoutes(app, router);
  outputRoutes(app, router);
  bedrockRoutes(app, router);
  updateRoutes(app, router);

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
    return { settings: await app.updateSettings(body) };
  });

  return app;
}
