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

/** Poll a job until it leaves queued/running. */
export async function waitForJob(app: TestApp, jobId: string, timeoutMs = 30_000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await app.json(`/api/jobs/${jobId}`);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms`);
}

export const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
export const put = (body: unknown): RequestInit => ({ method: 'PUT', body: JSON.stringify(body) });

/** A style plus an explainer with an approved plan, ready to build. */
export async function approvedExplainer(app: TestApp, outputType = 'video'): Promise<{ id: string; styleId: string }> {
  const style = await app.json('/api/styles', post({ name: 'Neon', description: 'neon blue/green', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const e = await app.json('/api/explainers', post({ brief: 'queues vs streams', sources: [{ kind: 'note', value: 'Queues buffer work; streams replay it.' }], styleId: style.id, outputType }));
  for (const step of ['report', 'plan']) {
    const job = await waitForJob(app, (await app.json(`/api/explainers/${e.id}/${step}`, post({}))).id);
    if (job.status !== 'succeeded') throw new Error(`${step} failed: ${job.error}`);
  }
  await app.json(`/api/explainers/${e.id}/approve`, post({}));
  return { id: e.id, styleId: style.id };
}
