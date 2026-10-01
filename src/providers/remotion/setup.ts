// Installs (or refreshes) the Remotion project cache now instead of on the first render:
//   node src/providers/remotion/setup.ts
import { defaultHome } from '../../datadir.ts';
import { ensureProject, remotionProjectDir } from './project.ts';

const stamp = await ensureProject(remotionProjectDir(defaultHome()), { onLog: (l) => console.log(l) });
console.log(`ready: Remotion ${stamp.remotion}, upstream skills ${stamp.skills ? 'installed' : 'MISSING (needs network access to GitHub)'}`);
