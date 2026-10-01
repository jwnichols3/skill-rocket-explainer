import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../../src/media.ts';

const WEB = fileURLToPath(new URL('../../web/js/', import.meta.url));

test('every browser module parses', async () => {
  const files = (await readdir(WEB, { recursive: true })).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 5);
  for (const f of files) {
    const r = await exec(process.execPath, ['--check', join(WEB, f)]);
    assert.equal(r.code, 0, `${f}: ${r.stderr}`);
  }
});
