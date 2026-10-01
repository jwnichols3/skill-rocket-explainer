import { access, cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { exec } from '../../media.ts';

/**
 * The HyperFrames toolchain lives in a shared cache under the data dir, never in the app's
 * package.json: the `hyperframes` CLI (and its deps), GSAP (served locally to compositions so
 * renders need no network) and HyperFrames' own agent skills, all pinned to one release so the
 * skills describe the CLI that renders.
 *
 *   <home>/cache/hyperframes/<version>/
 *     package.json, node_modules/   npm install of hyperframes + gsap
 *     skills/<name>/                from the GitHub release tarball of the same version
 *     ready.json                    written last; its presence means "installed"
 */
export const HYPERFRAMES_VERSION = '0.8.106';
export const GSAP_VERSION = '3.15.0';
export const HYPERFRAMES_SOURCE = 'https://github.com/heygen-com/hyperframes';

/** Skills a scene agent needs: composition contract, motion, seek-safe keyframes, design, CLI/lint codes. */
export const SCENE_SKILLS = ['hyperframes', 'hyperframes-core', 'hyperframes-animation', 'hyperframes-keyframes', 'hyperframes-creative', 'hyperframes-cli'];

export interface Toolchain {
  dir: string;
  /** The hyperframes CLI entry (run with node). */
  cli: string;
  gsap: string;
  skillsDir: string;
}

export function toolchainDir(cacheRoot: string): string {
  return join(cacheRoot, HYPERFRAMES_VERSION);
}

export function toolchainAt(dir: string): Toolchain {
  return {
    dir,
    cli: join(dir, 'node_modules', 'hyperframes', 'bin', 'hyperframes.mjs'),
    gsap: join(dir, 'node_modules', 'gsap', 'dist', 'gsap.min.js'),
    skillsDir: join(dir, 'skills'),
  };
}

const exists = (f: string) => access(f).then(() => true, () => false);

export async function isInstalled(cacheRoot: string): Promise<boolean> {
  return exists(join(toolchainDir(cacheRoot), 'ready.json'));
}

/** Environment for every hyperframes CLI call: no telemetry, no update checks, no global skill installs. */
export function hyperframesEnv(): NodeJS.ProcessEnv {
  return { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_SKIP_SKILLS: '1' };
}

const installs = new Map<string, Promise<Toolchain>>();

/**
 * Installs the toolchain once (idempotent, safe across processes: it builds in a temp dir and
 * renames into place; the loser of a race discards its copy).
 */
export function ensureToolchain(cacheRoot: string, onLog?: (line: string) => void): Promise<Toolchain> {
  const dir = toolchainDir(cacheRoot);
  let p = installs.get(dir);
  if (!p) {
    p = install(cacheRoot, onLog).finally(() => installs.delete(dir));
    installs.set(dir, p);
  }
  return p;
}

async function install(cacheRoot: string, onLog?: (line: string) => void): Promise<Toolchain> {
  const dir = toolchainDir(cacheRoot);
  if (await exists(join(dir, 'ready.json'))) return toolchainAt(dir);
  await mkdir(cacheRoot, { recursive: true });
  const tmp = await mkdtemp(join(cacheRoot, '.install-'));
  try {
    onLog?.(`installing HyperFrames ${HYPERFRAMES_VERSION} into ${dir} (one-time)`);
    await writeFile(join(tmp, 'package.json'), JSON.stringify({
      name: 'rocket-explainer-hyperframes-toolchain', private: true,
      dependencies: { hyperframes: HYPERFRAMES_VERSION, gsap: GSAP_VERSION },
    }, null, 2));
    const npm = await exec('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: tmp, env: hyperframesEnv(), timeoutMs: 15 * 60_000 });
    if (npm.code !== 0) throw new Error(`npm install of hyperframes@${HYPERFRAMES_VERSION} failed: ${(npm.stderr || npm.stdout).trim().slice(-1500)}`);

    onLog?.(`fetching HyperFrames ${HYPERFRAMES_VERSION} agent skills`);
    await fetchSkills(tmp);

    await writeFile(join(tmp, 'ready.json'), JSON.stringify({ hyperframes: HYPERFRAMES_VERSION, gsap: GSAP_VERSION, skills: SCENE_SKILLS, installedAt: new Date().toISOString() }, null, 2));
    try {
      await rename(tmp, dir);
    } catch (err: any) {
      // Another process finished first; use theirs.
      if (!(await exists(join(dir, 'ready.json')))) throw err;
    }
    onLog?.('HyperFrames toolchain ready');
    return toolchainAt(dir);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Extracts SCENE_SKILLS from the release tarball (skills are not all shipped in the npm package). */
async function fetchSkills(into: string): Promise<void> {
  const url = `https://codeload.github.com/heygen-com/hyperframes/tar.gz/refs/tags/v${HYPERFRAMES_VERSION}`;
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`could not download HyperFrames skills (${url}): HTTP ${res.status}`);
  const tarball = join(into, 'source.tar.gz');
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tarball));
  const root = `hyperframes-${HYPERFRAMES_VERSION}`;
  const members = SCENE_SKILLS.map((s) => `${root}/skills/${s}`);
  const out = join(into, 'extract');
  await mkdir(out, { recursive: true });
  const tar = await exec('tar', ['-xzf', tarball, '-C', out, ...members]);
  if (tar.code !== 0) throw new Error(`could not extract HyperFrames skills: ${tar.stderr.trim()}`);
  await cp(join(out, root, 'skills'), join(into, 'skills'), { recursive: true });
  await rm(out, { recursive: true, force: true });
  await rm(tarball, { force: true });
  for (const s of SCENE_SKILLS) {
    if (!(await exists(join(into, 'skills', s, 'SKILL.md')))) throw new Error(`HyperFrames skill ${s} missing from ${url}`);
  }
}
