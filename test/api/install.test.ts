// install.sh against a tarball built from the working tree (scripts/package.sh, as the release
// workflow does), into a throwaway HOME. Runs `npm ci --omit=dev`, so it needs the npm registry.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readlink, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../../src/media.ts';
import { freePort } from '../helpers/cli.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const VERSION: string = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const tmp = await mkdtemp(join(tmpdir(), 'explainer-install-'));
const home = join(tmp, 'home');
const data = join(home, '.rocket-explainer');
const binDir = join(tmp, 'bin');
const shim = join(binDir, 'explainer');
const env: NodeJS.ProcessEnv = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, EXPLAINER_HOME: data, EXPLAINER_BIN_DIR: binDir, EXPLAINER_NO_BROWSER: '1',
};

after(async () => {
  await exec(shim, ['stop'], { env });
  await rm(tmp, { recursive: true, force: true });
});

async function sh(cmd: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  const r = await exec(cmd, args, { env: { ...env, ...extra }, timeoutMs: 180_000 });
  assert.equal(r.code, 0, `${cmd} ${args.join(' ')}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** The user's data, which installs must leave alone. */
async function userData() {
  return Promise.all(['settings.json', 'styles/st_mine/style.json', 'explainers/ex_mine/explainer.json'].map((f) => readFile(join(data, f), 'utf8')));
}

async function status(port: number) {
  try { return await (await fetch(`http://127.0.0.1:${port}/api/status`)).json(); } catch { return null; }
}
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 30_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}

test('install.sh installs from a tarball, is idempotent, upgrades alongside, and restart switches versions', { timeout: 600_000 }, async () => {
  const tarball = (await sh('sh', [join(ROOT, 'scripts/package.sh'), join(tmp, 'dist')])).trim();
  assert.match(tarball, new RegExp(`rocket-explainer-${VERSION.replace(/\./g, '\\.')}\\.tar\\.gz$`));
  const listing = await sh('tar', ['-tzf', tarball]);
  for (const f of ['bin/explainer.ts', 'src/main.ts', 'web/index.html', 'skill/explainer/SKILL.md', 'package-lock.json', 'LICENSE']) assert.ok(listing.includes(`rocket-explainer-${VERSION}/${f}`), f);
  for (const f of ['/test/', '/docs/', '/prototypes/', 'node_modules']) assert.ok(!listing.includes(f), `tarball must not hold ${f}`);

  // Existing user data, on fake providers so the installed app starts without real ones.
  await mkdir(join(data, 'styles/st_mine'), { recursive: true });
  await mkdir(join(data, 'explainers/ex_mine'), { recursive: true });
  const port = await freePort();
  await writeFile(join(data, 'settings.json'), JSON.stringify({ port, setupComplete: true, seeded: true, providers: { agent: 'fake', tts: 'fake', renderer: { video: 'fake', deck: 'fake', doc: 'fake', visual: 'fake' } } }));
  await writeFile(join(data, 'styles/st_mine/style.json'), '{"name":"Mine"}');
  await writeFile(join(data, 'explainers/ex_mine/explainer.json'), '{"title":"Mine"}');
  const before = await userData();

  const first = await sh('sh', [join(ROOT, 'install.sh')], { EXPLAINER_TARBALL: tarball });
  assert.match(first, new RegExp(`Rocket Explainer v${VERSION} installed`));
  assert.match(first, /is not on your PATH/);
  assert.match(first, /Next: run `explainer setup`/);
  assert.equal(await readlink(join(data, 'app/current')), VERSION);
  assert.match(await sh(shim, ['--help']), /explainer - Rocket Explainer/);
  const skill = join(home, '.claude/skills/explainer/SKILL.md');
  assert.equal(await readFile(skill, 'utf8'), await readFile(join(ROOT, 'skill/explainer/SKILL.md'), 'utf8'));
  assert.deepEqual(await userData(), before);

  // Same version again: nothing reinstalled.
  const appStat = await stat(join(data, 'app', VERSION));
  const second = await sh('sh', [join(ROOT, 'install.sh')], { EXPLAINER_TARBALL: tarball, EXPLAINER_VERSION: `v${VERSION}` });
  assert.match(second, /already installed/);
  assert.equal((await stat(join(data, 'app', VERSION))).ino, appStat.ino);
  assert.deepEqual((await readdir(join(data, 'app'))).sort(), [VERSION, 'current']);
  assert.deepEqual(await userData(), before);

  // The installed app runs.
  await sh(shim, ['start']);
  const s1 = await status(port);
  assert.equal(s1?.version, VERSION);

  // A newer version installs alongside and becomes current; the skill honours CLAUDE_CONFIG_DIR.
  const next = VERSION.replace(/\d+$/, (n) => String(Number(n) + 1));
  const unpacked = join(tmp, 'next');
  await mkdir(unpacked);
  await sh('tar', ['-xzf', tarball, '-C', unpacked]);
  const pkgFile = join(unpacked, `rocket-explainer-${VERSION}`, 'package.json');
  await writeFile(pkgFile, (await readFile(pkgFile, 'utf8')).replace(`"version": "${VERSION}"`, `"version": "${next}"`));
  const nextTarball = join(tmp, `rocket-explainer-${next}.tar.gz`);
  await sh('tar', ['-czf', nextTarball, '-C', unpacked, `rocket-explainer-${VERSION}`]);
  const claudeDir = join(tmp, 'claude-config');
  const third = await sh('sh', [join(ROOT, 'install.sh')], { EXPLAINER_TARBALL: nextTarball, CLAUDE_CONFIG_DIR: claudeDir });
  assert.match(third, new RegExp(`Switched from v${VERSION}.*explainer restart`, 's'));
  assert.equal(await readlink(join(data, 'app/current')), next);
  assert.deepEqual((await readdir(join(data, 'app'))).sort(), [VERSION, next, 'current'].sort());
  await stat(join(claudeDir, 'skills/explainer/SKILL.md'));
  assert.deepEqual(await userData(), before);

  // The Settings "Restart now" path: the running old version restarts onto the new one.
  const res = await fetch(`http://127.0.0.1:${port}/api/update/restart`, { method: 'POST', headers: { 'x-explainer': '1' } });
  assert.equal(res.status, 200, await res.text());
  const s2 = await until(() => status(port), (s) => s?.version === next);
  assert.equal(s2?.version, next);
});
