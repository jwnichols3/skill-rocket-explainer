import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** The user-level data dir. Overridable with EXPLAINER_HOME. */
export function defaultHome(): string {
  return process.env.EXPLAINER_HOME || join(homedir(), '.rocket-explainer');
}

export function paths(home: string) {
  return {
    home,
    settings: join(home, 'settings.json'),
    secrets: join(home, 'secrets.json'),
    styles: join(home, 'styles'),
    explainers: join(home, 'explainers'),
    logs: join(home, 'logs'),
    jobs: join(home, 'jobs'),
    run: join(home, 'run'),
    serverInfo: join(home, 'run', 'server.json'),
  };
}
export type Paths = ReturnType<typeof paths>;

export async function ensureDataDir(home: string): Promise<Paths> {
  const p = paths(home);
  for (const dir of [p.home, p.styles, p.explainers, p.logs, p.jobs, p.run]) await mkdir(dir, { recursive: true });
  return p;
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err: any) {
    // ENOTDIR: a stray file (e.g. .DS_Store) where a folder was expected.
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fallback;
    throw err;
  }
}

/** Atomic write: temp file then rename, so a crash never leaves half a file. */
export async function writeFileAtomic(file: string, data: string | Uint8Array, mode?: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, data, mode ? { mode } : undefined);
  if (mode) await chmod(tmp, mode);
  await rename(tmp, file);
}

export function writeJson(file: string, value: unknown, mode?: number): Promise<void> {
  return writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n', mode);
}
