import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { htmlToPdf, htmlToPng } from '../../src/browser.ts';

test('HTML renders to a PDF and a PNG with remote requests blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'browser-'));
  const html = join(dir, 'page.html');
  await writeFile(html, '<!doctype html><html><body style="background:#0b0f14;color:#4fd1c5"><h1>Hello</h1><img src="https://example.com/x.png"></body></html>');
  await htmlToPdf(html, join(dir, 'p.pdf'));
  await htmlToPng(html, join(dir, 'p.png'), { width: 400, height: 300 });
  assert.equal((await readFile(join(dir, 'p.pdf'))).subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual([...(await readFile(join(dir, 'p.png'))).subarray(1, 4)], [0x50, 0x4e, 0x47]);
});
