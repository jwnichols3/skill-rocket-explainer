import { createServer, type Server } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDataDir, writeJson } from './datadir.ts';
import { loadSettings, saveSettings, merge, DEFAULT_SETTINGS } from './settings.ts';
import { checkRequest, allowedHostSet } from './guards.ts';
import { Router, HttpError, readBody, sendJson } from './router.ts';
import { createApp } from './app.ts';
import { VERSION } from './version.ts';

const WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

export interface StartOptions {
  home: string;
  /** 0 picks a free port. Defaults to the configured port. */
  port?: number;
  /** Settings to write before starting (merged over the existing file). */
  settings?: Record<string, unknown>;
}

export interface RunningServer {
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

/** Serve a file with Range support (video seeking needs it). Confined to `root`. */
export async function sendFile(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, root: string, rel: string, download?: string) {
  const file = normalize(join(root, rel));
  if (!file.startsWith(normalize(root + sep))) throw new HttpError(403, 'path escapes root');
  let st;
  try { st = await stat(file); } catch { throw new HttpError(404, 'not found'); }
  if (!st.isFile()) throw new HttpError(404, 'not found');
  const headers: Record<string, string | number> = {
    'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'no-cache',
  };
  if (download) headers['content-disposition'] = `attachment; filename="${download.replace(/"/g, '')}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'content-length': st.size });
  if (req.method === 'HEAD') { res.end(); return; }
  createReadStream(file).pipe(res);
}

export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const p = await ensureDataDir(opts.home);
  if (opts.settings) await saveSettings(p, opts.settings);
  const settings = await loadSettings(p);
  const port = opts.port ?? settings.port;

  const router = new Router();
  const app = await createApp(p, router);
  let allowed = allowedHostSet(port, settings.publicHostnames);
  app.onSettingsChanged((s) => { allowed = allowedHostSet(boundPort, s.publicHostnames); });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      const denied = checkRequest(req, allowed);
      if (denied) throw new HttpError(403, denied);
      const method = req.method === 'HEAD' ? 'GET' : req.method ?? 'GET';
      const route = router.match(method, url.pathname);
      if (route) {
        const body = method === 'GET' ? undefined : await readBody(req);
        const result = await route.handler({ req, res, url, params: route.params, body });
        if (!res.headersSent && result !== undefined) sendJson(res, 200, result);
        else if (!res.headersSent) { res.writeHead(204); res.end(); }
        return;
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'no such endpoint');
      // Static UI. Unknown paths fall back to the SPA shell.
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      try { await sendFile(req, res, WEB_ROOT, rel); }
      catch (err) { if (err instanceof HttpError && err.status === 404) await sendFile(req, res, WEB_ROOT, 'index.html'); else throw err; }
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : typeof err?.status === "number" ? err.status : 500;
      if (status === 500) app.log('error', `${req.method} ${url.pathname}: ${err?.stack ?? err}`);
      if (!res.headersSent) sendJson(res, status, { error: err?.message ?? String(err) });
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, settings.host, () => resolve());
  });
  const boundPort = (server.address() as import('node:net').AddressInfo).port;
  allowed = allowedHostSet(boundPort, settings.publicHostnames);
  const url = `http://${settings.host}:${boundPort}`;
  await writeJson(p.serverInfo, { pid: process.pid, port: boundPort, url, version: VERSION, startedAt: new Date().toISOString() });

  return {
    url,
    port: boundPort,
    server,
    async close() {
      await app.shutdown();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export { merge, DEFAULT_SETTINGS };
