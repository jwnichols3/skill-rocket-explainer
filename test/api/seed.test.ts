import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../../src/server.ts';
import { validateDesign } from '../../src/style/design.ts';

test("first run seeds the Hitchhiker's Guide style; deleting it doesn't bring it back", async () => {
  const home = await mkdtemp(join(tmpdir(), 'explainer-seed-'));
  try {
    let s = await startServer({ home, port: 0 });
    const get = (p: string) => fetch(s.url + p).then((r) => r.json());
    const [style] = await get('/api/styles');
    assert.equal(style.name, "Hitchhiker's Guide");
    assert.ok(style.savedAt);
    const full = await get(`/api/styles/${style.id}`);
    assert.deepEqual(validateDesign(full.design), []);
    assert.match(full.design, /neon blue\/green/);
    assert.equal(full.rounds.length, 0);
    await fetch(`${s.url}/api/styles/${style.id}`, { method: 'DELETE', headers: { 'x-explainer': '1' } });
    await s.close();
    s = await startServer({ home, port: 0 });
    assert.deepEqual(await (await fetch(s.url + '/api/styles')).json(), []);
    await s.close();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
