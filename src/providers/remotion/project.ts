import { createHash } from 'node:crypto';
import { access, cp, mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from '../../media.ts';
import { readJson } from '../../datadir.ts';

/** The Remotion project template (its own package.json and lockfile; not app dependencies). */
export const TEMPLATE_DIR = fileURLToPath(new URL('../../../templates/remotion/', import.meta.url));

/** Upstream Remotion agent skills, installed with the `skills` CLI as Remotion's docs describe. */
export const SKILLS_SOURCE = 'remotion-dev/skills';
export const SKILLS_CLI = 'skills@1';
export const SKILLS_ENTRY = join('.claude', 'skills', 'remotion-best-practices', 'SKILL.md');

const STAMP = '.ready.json';

export interface ProjectStamp { templateHash: string; remotion: string; skills: boolean; installedAt: string }

/** Where the installed project lives under the data dir. */
export function remotionProjectDir(home: string): string {
  return join(home, 'cache', 'remotion-project');
}

const exists = (f: string) => access(f).then(() => true, () => false);

async function listFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(p, base));
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out.sort();
}

/** Changes whenever the template changes, so the cache is reinstalled. */
export async function templateHash(): Promise<string> {
  const h = createHash('sha256');
  for (const f of await listFiles(TEMPLATE_DIR)) h.update(f).update('\0').update(await readFile(join(TEMPLATE_DIR, f))).update('\0');
  return h.digest('hex').slice(0, 16);
}

export function readStamp(dir: string): Promise<ProjectStamp | null> {
  return readJson<ProjectStamp | null>(join(dir, STAMP), null);
}

/** Path of Remotion's own Chrome Headless Shell download, if present. */
export async function browserDir(dir: string): Promise<string | null> {
  const p = join(dir, 'node_modules', '.remotion', 'chrome-headless-shell');
  return (await exists(p)) ? p : null;
}

type Log = (line: string) => void;

async function run(cmd: string, args: string[], cwd: string, log: Log, signal?: AbortSignal, env: NodeJS.ProcessEnv = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const r = await exec(cmd, args, { cwd, signal, env: { ...process.env, ...env }, onLine: (l) => l.trim() && log(l), timeoutMs: 15 * 60_000 });
  if (r.code !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(-1500)}`);
}

/** Installs the upstream Remotion skills as project skills (.claude/skills) so an agent running in the project finds them. */
export async function installSkills(dir: string, log: Log, signal?: AbortSignal): Promise<boolean> {
  try {
    await run('npx', ['-y', SKILLS_CLI, 'add', SKILLS_SOURCE, '--skill', '*', '--agent', 'claude-code', '--copy', '-y'], dir, log, signal,
      { DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1' });
    return await exists(join(dir, SKILLS_ENTRY));
  } catch (err: any) {
    log(`warning: could not install the upstream Remotion skills: ${err.message}`);
    return false;
  }
}

const installing = new Map<string, Promise<ProjectStamp>>();

/**
 * Installs the template into `dir` once (npm ci, upstream skills, Remotion's headless Chrome),
 * reinstalling when the template changes. Builds in a temp dir and renames, so a half install never counts.
 */
export function ensureProject(dir: string, opts: { onLog?: Log; signal?: AbortSignal } = {}): Promise<ProjectStamp> {
  let p = installing.get(dir);
  if (!p) {
    p = doEnsure(dir, opts.onLog ?? (() => {}), opts.signal).finally(() => installing.delete(dir));
    installing.set(dir, p);
  }
  return p;
}

async function doEnsure(dir: string, log: Log, signal?: AbortSignal): Promise<ProjectStamp> {
  const hash = await templateHash();
  const stamp = await readStamp(dir);
  if (stamp?.templateHash === hash) {
    if (stamp.skills) return stamp;
    const next = { ...stamp, skills: await installSkills(dir, log, signal) };
    await writeFile(join(dir, STAMP), JSON.stringify(next, null, 2));
    return next;
  }
  log(`installing the Remotion project into ${dir} (one-time; needs network)`);
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(tmp, { recursive: true });
  try {
    await cp(TEMPLATE_DIR, tmp, { recursive: true });
    await run('npm', ['ci', '--no-audit', '--no-fund'], tmp, log, signal);
    const skills = await installSkills(tmp, log, signal);
    await run('npx', ['--no-install', 'remotion', 'browser', 'ensure'], tmp, log, signal);
    const pkg = JSON.parse(await readFile(join(tmp, 'node_modules', 'remotion', 'package.json'), 'utf8'));
    const next: ProjectStamp = { templateHash: hash, remotion: pkg.version, skills, installedAt: new Date().toISOString() };
    await writeFile(join(tmp, STAMP), JSON.stringify(next, null, 2));
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
    log(`Remotion ${next.remotion} installed${skills ? ' with upstream skills' : ' (upstream skills missing)'}`);
    return next;
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

/** A per-render copy of the installed project: sources and skills copied, node_modules linked to the cache. */
export async function prepareRenderProject(cacheDir: string, projectDir: string): Promise<void> {
  const nm = join(cacheDir, 'node_modules');
  await cp(cacheDir, projectDir, {
    recursive: true,
    filter: (src) => src !== nm && !src.startsWith(nm + sep) && !src.endsWith(sep + STAMP),
  });
  await rm(join(projectDir, 'node_modules'), { force: true, recursive: true });
  await symlink(nm, join(projectDir, 'node_modules'), 'dir');
  await mkdir(join(projectDir, 'src', 'scenes'), { recursive: true });
}
