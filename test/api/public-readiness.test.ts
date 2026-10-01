import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../../src/media.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/public-readiness.ts');
const dirs: string[] = [];
after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

test('the repo passes the public-readiness check', async () => {
  const r = await exec(process.execPath, [SCRIPT, ROOT]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
});

test('the check reports personal paths, keys, account ids and denylisted names with file:line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'explainer-readiness-'));
  dirs.push(dir);
  // Built from pieces so this file does not trip the check itself.
  const user = 'j' + 'doe';
  const lines = [
    'ok line',
    `cd /Users/${user}/code`,
    `key = ${'AKIA' + 'Q7'.repeat(8)}`,
    `-----BEGIN RSA ${'PRIVATE'} KEY-----`,
    `arn:aws:iam::${'4815162342'}42:role/x`,
    'fake: /Users/you/x /home/user/y 000000000000 123456789012 AKIAIOSFODNN7EXAMPLE',
    `allowed /home/${user} # public-readiness: allow`,
    `signed by Jane ${'Q'}uux`,
  ];
  await writeFile(join(dir, 'notes.md'), lines.join('\n'));
  await writeFile(join(dir, '.gitignore'), '.public-readiness-denylist\n');
  await writeFile(join(dir, '.public-readiness-denylist'), '# names\nquux\n');
  assert.equal((await exec('git', ['init', '-q'], { cwd: dir })).code, 0);

  const r = await exec(process.execPath, [SCRIPT, dir]);
  assert.equal(r.code, 1);
  const found = r.stdout.split('\n').filter((l) => l.startsWith('notes.md:'));
  assert.deepEqual(found, [
    `notes.md:2: personal path: /Users/${user}`,
    `notes.md:3: AWS access key: ${'AKIA' + 'Q7'.repeat(8)}`,
    `notes.md:4: private key: -----BEGIN RSA ${'PRIVATE'} KEY-----`,
    `notes.md:5: AWS account id: ${'4815162342'}42`,
    `notes.md:8: denylisted identifier: ${'Q'}uux`,
  ]);
});
