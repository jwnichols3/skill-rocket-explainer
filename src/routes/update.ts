import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { App } from '../app.ts';
import type { Router } from '../router.ts';
import { HttpError } from '../router.ts';
import { VERSION } from '../version.ts';
import { exec } from '../media.ts';
import { startJob } from './styles.ts';

/** The GitHub repo releases come from (install.sh has the same default). EXPLAINER_REPO overrides it. */
export const RELEASE_REPO = 'jwnichols3/skill-rocket-explainer';
const repo = () => process.env.EXPLAINER_REPO || RELEASE_REPO;
/** Overridable so tests can point it at a local mock. */
const apiBase = () => process.env.EXPLAINER_GITHUB_API || 'https://api.github.com';

function parseVersion(v: string): { nums: number[]; pre: string[] } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] } : null;
}

/** Semver ordering: -1, 0 or 1. A leading "v" is ignored; 1.0.0-rc.1 < 1.0.0. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) throw new Error(`not a version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return Math.sign(y.pre.length - x.pre.length);
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === q) continue;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

/** GITHUB_TOKEN, else `gh auth token` when gh is installed and signed in. */
async function githubToken(): Promise<string | null> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const r = await exec('gh', ['auth', 'token'], { timeoutMs: 5000 });
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

interface Asset { name: string; url: string; browser_download_url: string }
interface Release { tag_name: string; html_url: string; published_at: string; body: string | null; assets: Asset[] }

/** The latest release, or the one tagged `tag`. Problems GitHub reports come back as `problem`, not thrown. */
async function fetchRelease(tag?: string): Promise<{ release?: Release; problem?: string; token: string | null }> {
  const token = await githubToken();
  const path = tag ? `/releases/tags/${encodeURIComponent(tag)}` : '/releases/latest';
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/repos/${repo()}${path}`, { headers: headers(token), signal: AbortSignal.timeout(15000) });
  } catch (err: any) {
    return { token, problem: `couldn't reach GitHub: ${err?.cause?.message ?? err?.message ?? err}` };
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') return { token, problem: 'GitHub rate limit reached; try again later' };
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return { token, problem: `can't see releases (private repo?)${token ? ', or none published yet' : '. Set GITHUB_TOKEN or sign in with `gh auth login`'}` };
  }
  if (!res.ok) return { token, problem: `GitHub answered ${res.status}` };
  return { token, release: await res.json() as Release };
}

function headers(token: string | null, accept = 'application/vnd.github+json'): Record<string, string> {
  return { accept, 'user-agent': 'rocket-explainer', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

/** Private repos need the API asset URL plus a token; public ones work from the plain download URL. */
async function download(asset: Asset, file: string, token: string | null, signal: AbortSignal) {
  const res = token
    ? await fetch(asset.url, { headers: headers(token, 'application/octet-stream'), signal })
    : await fetch(asset.browser_download_url, { headers: { 'user-agent': 'rocket-explainer' }, signal });
  if (!res.ok) throw new Error(`downloading ${asset.name} failed: ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

const strip = (tag: string) => tag.replace(/^v/, '');

export function updateRoutes(app: App, router: Router) {
  // Compares this version with the latest GitHub release.
  router.get('/api/update', async () => {
    const { release, problem } = await fetchRelease();
    if (!release) return { current: VERSION, latest: null, newer: false, problem };
    try {
      return {
        current: VERSION, latest: strip(release.tag_name), tag: release.tag_name, newer: compareVersions(release.tag_name, VERSION) > 0,
        url: release.html_url, publishedAt: release.published_at, notes: release.body ?? '',
      };
    } catch {
      return { current: VERSION, latest: null, newer: false, problem: `the latest release tag "${release.tag_name}" is not a version` };
    }
  });

  // Downloads the release's install.sh and tarball and runs install.sh as a background job.
  router.post('/api/update/install', ({ body }) => {
    const tag = typeof body?.tag === 'string' && body.tag ? body.tag : undefined;
    return startJob(app, 'update', 'app:update', async (ctx) => {
      ctx.stage('finding release', 0.05, tag ?? 'latest');
      const { release, problem, token } = await fetchRelease(tag);
      if (!release) throw new Error(problem);
      const version = strip(release.tag_name);
      const script = release.assets.find((a) => a.name === 'install.sh');
      const tarball = release.assets.find((a) => a.name === `rocket-explainer-${version}.tar.gz`);
      if (!script || !tarball) throw new Error(`release ${release.tag_name} is missing install.sh or rocket-explainer-${version}.tar.gz`);
      const dir = await mkdtemp(join(tmpdir(), 'explainer-update-'));
      try {
        ctx.stage('downloading', 0.15, tarball.name);
        await download(script, join(dir, 'install.sh'), token, ctx.signal);
        await download(tarball, join(dir, tarball.name), token, ctx.signal);
        ctx.stage('installing', 0.3, `v${version}`);
        const r = await exec('sh', [join(dir, 'install.sh')], {
          env: { ...process.env, EXPLAINER_HOME: app.paths.home, EXPLAINER_VERSION: release.tag_name, EXPLAINER_TARBALL: join(dir, tarball.name) },
          signal: ctx.signal, onLine: (l) => ctx.log(l),
        });
        if (r.code !== 0) throw new Error(`install.sh failed (exit ${r.code})`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      return { installed: version, restart: true };
    });
  });

  // Restarts on the installed `current` version, via a detached `explainer restart`.
  router.post('/api/update/restart', () => {
    const cli = join(app.paths.home, 'app', 'current', 'bin', 'explainer.ts');
    if (!existsSync(cli)) throw new HttpError(409, 'this copy was not installed with install.sh; restart it with `explainer stop` then `explainer start`');
    spawn(process.execPath, [cli, 'restart'], { detached: true, stdio: 'ignore', env: { ...process.env, EXPLAINER_HOME: app.paths.home } }).unref();
    return { restarting: true };
  });
}
