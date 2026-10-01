import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer, type RunningServer } from '../../src/server.ts';

export interface TestApp extends RunningServer {
  home: string;
  api(path: string, init?: RequestInit): Promise<Response>;
  json<T = any>(path: string, init?: RequestInit): Promise<T>;
  stop(): Promise<void>;
}

/** Starts the app on a random loopback port with a throwaway data dir and fake providers. */
export async function startTestApp(settings: Record<string, unknown> = {}): Promise<TestApp> {
  const home = await mkdtemp(join(tmpdir(), 'explainer-test-'));
  const server = await startServer({
    home,
    port: 0,
    settings: { providers: { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'fake', doc: 'fake', visual: 'fake' } }, ...settings },
  });
  const api = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (init.method && init.method !== 'GET' && !headers.has('x-explainer')) headers.set('x-explainer', '1');
    if (init.body && typeof init.body === 'string' && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return fetch(server.url + path, { ...init, headers });
  };
  return {
    ...server,
    home,
    api,
    async json(path, init) {
      const res = await api(path, init);
      const body = await res.json();
      if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
      return body;
    },
    async stop() {
      await server.close();
      await rm(home, { recursive: true, force: true });
    },
  };
}
