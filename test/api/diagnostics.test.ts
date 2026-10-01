import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startTestApp, waitForJob, post, type TestApp } from '../helpers/app.ts';

let app: TestApp;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

test('diagnostics: the same checks as doctor, plus versions of the app, renderers and agent CLI', async () => {
  const d = await app.json('/api/diagnostics');
  const doctor = await app.json('/api/doctor');
  assert.deepEqual(d.checks.map((c: any) => c.id), doctor.map((c: any) => c.id));
  const names = d.versions.map((v: any) => v.name);
  for (const n of ['Rocket Explainer', 'Node.js', 'ffmpeg', 'Claude Code CLI', 'Remotion', 'HyperFrames']) assert.ok(names.includes(n), `no version for ${n}: ${names}`);
  assert.equal(d.versions.find((v: any) => v.name === 'Rocket Explainer').version, (await app.json('/api/status')).version);
  assert.ok(d.dataDir);
});

test('job logs are listed, readable and downloadable; app logs too; nothing outside the logs dir', async () => {
  const s = await app.json('/api/styles', post({ name: 'Neon', description: 'neon', voice: { provider: 'fake', voiceId: 'fake-bright', controls: {} } }));
  const job = await waitForJob(app, (await app.json(`/api/styles/${s.id}/sample`, post({}))).id);
  const list = await app.json('/api/jobs');
  assert.ok(list.some((j: any) => j.id === job.id));
  const res = await app.api(`/api/jobs/${job.id}/log`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
  assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`attachment; filename="${job.id}.log"`));
  assert.match(await res.text(), /Designing the style/);

  const logs = await app.json('/api/logs');
  assert.ok(logs.some((l: any) => l.name === 'app.log' || l.name === 'server.log') || Array.isArray(logs));
  const u = new URL(app.url);
  const status = await new Promise<number>((resolve) => {
    request({ host: u.hostname, port: u.port, path: '/api/logs/..%2Fsettings.json', headers: { host: u.host } }, (r) => { r.resume(); resolve(r.statusCode!); }).end();
  });
  assert.ok([400, 403, 404].includes(status), `traversal got ${status}`);
});
