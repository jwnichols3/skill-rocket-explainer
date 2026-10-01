import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckDef } from '../../doctor.ts';
import { commandVersion } from '../../doctor.ts';
import { remotionProjectDir, readStamp, templateHash, browserDir, SKILLS_ENTRY, SKILLS_SOURCE } from './project.ts';

const SETUP = 'node src/providers/remotion/setup.ts';
const exists = (f: string) => access(f).then(() => true, () => false);

/** Doctor checks for the Remotion renderer. They look at the data dir the CLI uses ($EXPLAINER_HOME or the default). */
export const REMOTION_CHECKS: CheckDef[] = [
  {
    id: 'remotion-npm', label: 'npm/npx (installs the Remotion project)',
    async run(_s, p) {
      const v = await commandVersion('npx', ['--version']);
      return v ? { ok: true, detail: `npx ${v}` } : { ok: false, detail: 'missing', fix: 'npm and npx ship with Node.js: reinstall Node.js 24+' };
    },
  },
  {
    id: 'remotion-project', label: 'Remotion project cache', optional: true,
    async run(_s, p) {
      const dir = remotionProjectDir(p.home);
      const stamp = await readStamp(dir);
      if (!stamp) return { ok: false, detail: `not installed yet (${dir})`, fix: `installs on the first Remotion render (needs network), or now: ${SETUP}` };
      if (stamp.templateHash !== await templateHash()) return { ok: false, detail: 'out of date with the template', fix: `reinstalls on the next Remotion render, or now: ${SETUP}` };
      return { ok: true, detail: `Remotion ${stamp.remotion}, installed ${stamp.installedAt.slice(0, 10)}` };
    },
  },
  {
    id: 'remotion-skills', label: `Remotion agent skills (${SKILLS_SOURCE})`, optional: true,
    async run(_s, p) {
      const dir = remotionProjectDir(p.home);
      return await exists(join(dir, SKILLS_ENTRY))
        ? { ok: true, detail: 'installed as project skills' }
        : { ok: false, detail: 'not installed', fix: `needs network access to GitHub: ${SETUP} (or render once)` };
    },
  },
  {
    id: 'remotion-browser', label: 'Chrome Headless Shell for Remotion', optional: true,
    async run(_s, p) {
      const dir = await browserDir(remotionProjectDir(p.home));
      return dir ? { ok: true, detail: dir } : { ok: false, detail: 'not downloaded yet', fix: `Remotion downloads its own on setup or first render: ${SETUP}` };
    },
  },
];
