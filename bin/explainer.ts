#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHome, ensureDataDir, readJson } from '../src/datadir.ts';
import { loadSettings, saveSettings } from '../src/settings.ts';
import { parsePublicUrl } from '../src/routes/setup.ts';
import { runChecks, formatChecks } from '../src/doctor.ts';

const HELP = `explainer - Rocket Explainer local app

usage:
  explainer setup [--yes] [--port N] [--public-url URL] [--agent ID] [--aws-profile P] [--tts ID] [--video-renderer ID]
                               first-run setup (safe to re-run); --yes skips the web Setup page
  explainer start [--port N]   start the app (no-op if already running)
  explainer stop               stop the app
  explainer open [path]        start if needed and open the app in a browser
  explainer status             print whether the app is running
  explainer new [--brief TEXT] [--source S]... [--style NAME] [--type video|deck|doc|visual] [--title T] [--no-open]
                               create an explainer, start gathering its sources, open it
  explainer styles             list style names
  explainer doctor             check prerequisites and print fixes

Data dir: $EXPLAINER_HOME or ~/.rocket-explainer`;

interface ServerInfo { pid: number; port: number; url: string }

const home = defaultHome();
const p = await ensureDataDir(home);

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function flags(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === name && process.argv[i + 1] !== undefined ? [process.argv[i + 1]] : []));
}

async function call(info: ServerInfo, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'x-explainer': '1', 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}

/** The address the browser should use: the reverse-proxy URL when one is configured. */
async function browserUrl(info: ServerInfo, path = ''): Promise<string> {
  const s = await loadSettings(p);
  return (s.publicUrl || info.url) + path;
}

/** First-run setup: writes choices (keeping earlier ones), starts the app, runs doctor. Safe to re-run. */
async function setup() {
  const before = await loadSettings(p);
  const patch: Record<string, any> = {};
  const port = flag('--port');
  if (port) patch.port = Number(port);
  const pub = flag('--public-url');
  if (pub !== undefined) {
    try {
      const parsed = parsePublicUrl(pub);
      patch.publicUrl = parsed?.url ?? '';
      patch.publicHostnames = parsed ? [parsed.host] : [];
    } catch (err: any) { console.error(err.message); process.exit(1); }
  }
  const providers: Record<string, any> = {};
  if (flag('--agent')) providers.agent = flag('--agent');
  if (flag('--tts')) providers.tts = flag('--tts');
  if (flag('--video-renderer')) providers.renderer = { video: flag('--video-renderer') };
  if (Object.keys(providers).length) patch.providers = providers;
  const profile = flag('--aws-profile');
  if (profile) { patch.polly = { profile }; patch.bedrock = { profile }; }
  if (process.argv.includes('--yes')) patch.setupComplete = true;
  const settings = await saveSettings(p, patch);

  // A port change needs a restart; otherwise reuse the running app.
  const current = await running();
  if (current && current.port !== settings.port) await stop();
  const info = await start();

  const checks = await runChecks(settings, p);
  console.log(formatChecks(checks));
  const missing = checks.filter((c) => !c.ok && !c.optional);
  if (missing.length) console.log(`\n${missing.length} prerequisite(s) missing; the fixes are above.`);
  const url = await browserUrl(info, settings.setupComplete ? '/' : '/setup');
  console.log(`\n${before.setupComplete ? 'Setup updated' : 'Setup saved'}. Open ${url}`);
  if (!process.argv.includes('--no-open')) openBrowser(url);
}

/** Creates an explainer from flags (the chat entry flow hands off through this). */
async function newExplainer() {
  const info = await start();
  const styleArg = flag('--style');
  let styleId: string | null = null;
  if (styleArg) {
    const styles: { id: string; name: string | null }[] = await call(info, '/api/styles');
    const want = styleArg.toLowerCase();
    const hit = styles.find((s) => s.id === styleArg) ?? styles.find((s) => s.name?.toLowerCase() === want) ?? styles.find((s) => s.name?.toLowerCase().includes(want));
    if (!hit) {
      console.error(`no style matches "${styleArg}". Styles: ${styles.map((s) => s.name ?? s.id).join(', ') || 'none yet'}`);
      process.exit(1);
    }
    styleId = hit.id;
  }
  try {
    const e = await call(info, '/api/explainers', {
      title: flag('--title') ?? '', brief: flag('--brief') ?? '', styleId, outputType: flag('--type') ?? 'video',
      sources: flags('--source').map((value) => ({ value })),
    });
    await call(info, `/api/explainers/${e.id}/report`, {});
    const url = await browserUrl(info, `/explainers/${e.id}`);
    console.log(url);
    if (!process.argv.includes('--no-open')) openBrowser(url);
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
}

async function running(): Promise<ServerInfo | null> {
  const info = await readJson<ServerInfo | null>(p.serverInfo, null);
  if (!info) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/status`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body.app === 'rocket-explainer' && body.home === home ? info : null;
  } catch {
    return null;
  }
}

async function start(): Promise<ServerInfo> {
  const existing = await running();
  if (existing) {
    if (process.argv[2] === 'start') console.log(`already running at ${existing.url}`);
    return existing;
  }
  await rm(p.serverInfo, { force: true });
  const settings = await loadSettings(p);
  const port = flag('--port') ?? String(settings.port);
  const log = openSync(join(p.logs, 'server.log'), 'a');
  const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
  const child = spawn(process.execPath, [main, '--port', port], { detached: true, stdio: ['ignore', log, log], env: process.env });
  child.unref();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const info = await running();
    if (info) {
      if (process.argv[2] === 'start') console.log(`started at ${info.url}`);
      return info;
    }
    if (child.exitCode !== null) break;
  }
  console.error(`the app did not start; see ${join(p.logs, 'server.log')}`);
  process.exit(1);
}

async function stop() {
  const info = await readJson<ServerInfo | null>(p.serverInfo, null);
  if (!info || !(await running())) {
    await rm(p.serverInfo, { force: true });
    console.log('not running');
    return;
  }
  process.kill(info.pid, 'SIGTERM');
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (await running())) await new Promise((r) => setTimeout(r, 100));
  await rm(p.serverInfo, { force: true });
  console.log('stopped');
}

function openBrowser(url: string) {
  if (process.env.EXPLAINER_NO_BROWSER) return;
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(cmd, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

const cmd = process.argv[2];
switch (cmd) {
  case 'start': await start(); break;
  case 'stop': await stop(); break;
  case 'new': await newExplainer(); break;
  case 'setup': await setup(); break;
  case 'styles': {
    const info = await start();
    const styles: { id: string; name: string | null; savedAt: string | null }[] = await call(info, '/api/styles');
    for (const s of styles) console.log(`${s.name ?? 'Untitled style'}${s.savedAt ? '' : ' (draft)'}\t${s.id}`);
    break;
  }
  case 'open': {
    const info = await start();
    const url = await browserUrl(info, process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '/');
    console.log(url);
    openBrowser(url);
    break;
  }
  case 'status': {
    const info = await running();
    const s = await loadSettings(p);
    const setupNote = s.setupComplete ? '' : ' · setup incomplete: run `explainer setup`';
    console.log(info ? `running at ${await browserUrl(info)} (pid ${info.pid})${setupNote}` : `not running${setupNote}`);
    process.exit(info ? 0 : 1);
  }
  case 'doctor': {
    const checks = await runChecks(await loadSettings(p), p);
    console.log(formatChecks(checks));
    process.exit(checks.some((c) => !c.ok && !c.optional) ? 1 : 0);
  }
  default:
    console.log(HELP);
    process.exit(cmd && cmd !== 'help' && cmd !== '--help' ? 1 : 0);
}
