import { join } from 'node:path';
import type { CheckDef } from '../../doctor.ts';
import { commandVersion } from '../../doctor.ts';
import { defaultHome } from '../../datadir.ts';
import { exec } from '../../media.ts';
import { HYPERFRAMES_VERSION, hyperframesEnv, isInstalled, toolchainAt, toolchainDir } from './toolchain.ts';

export function hyperframesCacheRoot(home: string): string {
  return join(home, 'cache', 'hyperframes');
}

const setupCmd = `node ${join(import.meta.dirname, 'setup.ts')}`;

/** Doctor checks contributed when HyperFrames is the selected video renderer. */
export const HYPERFRAMES_CHECKS: CheckDef[] = [
  {
    id: 'hyperframes-npm', label: 'npm (installs HyperFrames)',
    async run() {
      const v = await commandVersion('npm');
      return v ? { ok: true, detail: v } : { ok: false, detail: 'missing', fix: 'npm ships with Node.js: reinstall Node.js 24+ (https://nodejs.org)' };
    },
  },
  {
    id: 'hyperframes-toolchain', label: `HyperFrames ${HYPERFRAMES_VERSION} toolchain`, optional: true,
    async run() {
      const root = hyperframesCacheRoot(defaultHome());
      if (await isInstalled(root)) return { ok: true, detail: toolchainDir(root) };
      return { ok: false, detail: `not installed yet in ${toolchainDir(root)} (installs automatically on the first HyperFrames render)`, fix: `install now: ${setupCmd}` };
    },
  },
  {
    id: 'hyperframes-browser', label: 'Chrome for HyperFrames rendering',
    async run() {
      const root = hyperframesCacheRoot(defaultHome());
      if (!(await isInstalled(root))) return { ok: false, detail: 'unknown until the HyperFrames toolchain is installed', fix: `install it: ${setupCmd}` };
      const tc = toolchainAt(toolchainDir(root));
      const r = await exec(process.execPath, [tc.cli, 'browser', 'path'], { env: hyperframesEnv(), timeoutMs: 30_000 });
      const path = r.stdout.trim().split('\n').at(-1)?.trim();
      if (r.code === 0 && path) return { ok: true, detail: path };
      return { ok: false, detail: 'no Chrome found', fix: `install Google Chrome, or download chrome-headless-shell with: node ${tc.cli} browser ensure (or set HYPERFRAMES_BROWSER_PATH)` };
    },
  },
];
