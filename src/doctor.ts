import { exec } from './media.ts';
import type { Settings } from './settings.ts';

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  /** Version or what was found / what went wrong. */
  detail: string;
  /** How to fix it, when not ok. */
  fix?: string;
  /** Optional checks warn instead of failing doctor. */
  optional?: boolean;
}

export interface CheckDef {
  id: string;
  label: string;
  optional?: boolean;
  /** Only run when this returns true for the current settings. */
  when?: (s: Settings) => boolean;
  run: (s: Settings) => Promise<Omit<Check, 'id' | 'label' | 'optional'>>;
}

/** Checks a command exists by running it with a version flag; returns the first output line. */
export async function commandVersion(cmd: string, args = ['--version']): Promise<string | null> {
  const r = await exec(cmd, args, { timeoutMs: 15000 });
  if (r.code === 127) return null;
  return (r.stdout || r.stderr).split('\n')[0].trim() || cmd;
}

const BASE_CHECKS: CheckDef[] = [
  {
    id: 'node', label: 'Node.js 24+',
    async run() {
      const major = Number(process.versions.node.split('.')[0]);
      return major >= 24 ? { ok: true, detail: process.version } : { ok: false, detail: process.version, fix: 'install Node.js 24 or newer (https://nodejs.org or `brew install node`)' };
    },
  },
  {
    id: 'ffmpeg', label: 'ffmpeg',
    async run() {
      const v = await commandVersion('ffmpeg', ['-version']);
      return v ? { ok: true, detail: v } : { ok: false, detail: 'missing', fix: 'install ffmpeg (`brew install ffmpeg` on macOS, `apt install ffmpeg` on Debian/Ubuntu)' };
    },
  },
  {
    id: 'ffprobe', label: 'ffprobe',
    async run() {
      const v = await commandVersion('ffprobe', ['-version']);
      return v ? { ok: true, detail: v } : { ok: false, detail: 'missing', fix: 'ffprobe ships with ffmpeg: install ffmpeg (`brew install ffmpeg`)' };
    },
  },
];

export const CHECKS: CheckDef[] = [...BASE_CHECKS];

/** Base checks plus those contributed by the selected providers (see providers/registry.ts). */
export async function runChecks(settings: Settings, defs?: CheckDef[]): Promise<Check[]> {
  const { providerChecks } = await import('./providers/registry.ts');
  const all = defs ?? [...CHECKS, ...providerChecks(settings)];
  const active = all.filter((d) => !d.when || d.when(settings));
  return Promise.all(active.map(async (d) => {
    try {
      return { id: d.id, label: d.label, optional: d.optional, ...(await d.run(settings)) };
    } catch (err: any) {
      return { id: d.id, label: d.label, optional: d.optional, ok: false, detail: String(err?.message ?? err), fix: 'see logs' };
    }
  }));
}

export function formatChecks(checks: Check[]): string {
  return checks.map((c) => {
    const mark = c.ok ? 'ok     ' : c.optional ? 'warn   ' : 'missing';
    const line = `${mark}  ${c.label}: ${c.detail}`;
    return c.ok || !c.fix ? line : `${line}\n         fix: ${c.fix}`;
  }).join('\n');
}
