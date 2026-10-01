import { readFile } from 'node:fs/promises';
import { VERSION } from './version.ts';
import { commandVersion } from './doctor.ts';
import { HYPERFRAMES_VERSION } from './providers/hyperframes/toolchain.ts';

export interface VersionInfo { name: string; version: string | null; detail?: string }

/** Pinned version from the Remotion project template (what renders use). */
async function remotionVersion(): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(new URL('../templates/remotion/package.json', import.meta.url), 'utf8'));
    return pkg.dependencies?.remotion ?? null;
  } catch {
    return null;
  }
}

/** Versions of the app and everything it drives. Missing tools report null. */
export async function versions(): Promise<VersionInfo[]> {
  const [ffmpeg, claude, remotion] = await Promise.all([commandVersion('ffmpeg', ['-version']), commandVersion('claude', ['--version']), remotionVersion()]);
  return [
    { name: 'Rocket Explainer', version: VERSION },
    { name: 'Node.js', version: process.versions.node },
    { name: 'ffmpeg', version: ffmpeg?.match(/version (\S+)/)?.[1] ?? ffmpeg },
    { name: 'Claude Code CLI', version: claude?.match(/^(\S+)/)?.[1] ?? null },
    { name: 'Remotion', version: remotion, detail: 'pinned in the render project template' },
    { name: 'HyperFrames', version: HYPERFRAMES_VERSION, detail: 'pinned toolchain' },
  ];
}
