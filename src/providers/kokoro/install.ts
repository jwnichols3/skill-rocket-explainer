import { access, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from '../../media.ts';
import { defaultHome, paths as dataPaths, type Paths } from '../../datadir.ts';

/**
 * Kokoro runtime choice: the official Python `kokoro` package (KPipeline), in a uv-built venv under
 * <data dir>/cache/kokoro, driven by a bundled worker script (kokoro_worker.py).
 *
 * Why this and not the alternatives:
 * - It is the reference implementation and the only runtime that exposes Kokoro's native per-token
 *   start_ts/end_ts (from the model's predicted durations), so word timings are native, not aligned.
 *   kokoro-js (npm/ONNX) returns audio only; its stock ONNX export drops the durations.
 * - uv makes it install reliably on macOS arm64 and Linux: kokoro needs Python 3.10-3.12 (newer
 *   system Pythons are rejected), and uv fetches a managed Python into this cache dir; `--torch-backend
 *   cpu` keeps Linux from pulling multi-GB CUDA wheels. espeak-ng comes bundled (espeakng-loader).
 * - Footprint, all under the cache dir: ~0.85 GB venv (torch dominates), ~0.33 GB model and English
 *   voices, ~50 MB Python. Delete the dir to uninstall.
 */

export const KOKORO_VERSION = '0.9.4';
/** Pinned Hugging Face revision of hexgrad/Kokoro-82M (v1.0 weights, Apache-2.0). */
export const MODEL_REVISION = 'f3ff3571791e39611d31c381e3a41a3af07b4987';
/** misaki's English G2P loads this spaCy model; installed up front so first use needs no network. */
const SPACY_MODEL = 'en_core_web_sm @ https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl';
const PACKAGES = [
  `kokoro==${KOKORO_VERSION}`, `misaki[en]==${KOKORO_VERSION}`, 'soundfile', 'huggingface_hub',
  // Without a floor the resolver can backtrack to transformers 4.12, which needs a Rust toolchain to build.
  'transformers>=4.40',
  SPACY_MODEL,
];

export interface KokoroLayout { dir: string; python: string; modelDir: string; marker: string; worker: string }

export function kokoroLayout(p: Pick<Paths, 'home'>): KokoroLayout {
  const dir = join(p.home, 'cache', 'kokoro');
  const python = process.platform === 'win32' ? join(dir, 'venv', 'Scripts', 'python.exe') : join(dir, 'venv', 'bin', 'python');
  return { dir, python, modelDir: join(dir, 'model'), marker: join(dir, 'installed.json'), worker: join(import.meta.dirname, 'kokoro_worker.py') };
}

/** The command that installs Kokoro, for doctor fixes and error messages. */
export const INSTALL_COMMAND = 'node src/providers/kokoro/install.ts';

const exists = (f: string) => access(f).then(() => true, () => false);

/** Installed = the marker install writes last, plus the venv Python and model it vouches for. */
export async function kokoroInstalled(l: KokoroLayout): Promise<{ ok: boolean; detail: string }> {
  const marker = await readFile(l.marker, 'utf8').then((s) => JSON.parse(s), () => null);
  if (!marker) return { ok: false, detail: `not installed (nothing at ${l.dir})` };
  for (const f of [l.python, join(l.modelDir, 'kokoro-v1_0.pth'), join(l.modelDir, 'config.json')]) {
    if (!(await exists(f))) return { ok: false, detail: `incomplete install: ${f} is missing` };
  }
  return { ok: true, detail: `kokoro ${marker.kokoro}, model ${String(marker.revision).slice(0, 8)} in ${l.dir}` };
}

/**
 * Builds the venv, installs kokoro and downloads the model plus English voices. Idempotent; needs
 * network and `uv` on PATH. Takes a few minutes the first time (~1.2 GB).
 */
export async function installKokoro(p: Pick<Paths, 'home'>, onLine: (l: string) => void = () => {}): Promise<KokoroLayout> {
  const l = kokoroLayout(p);
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: join(l.dir, 'python') };
  const run = async (cmd: string, args: string[]) => {
    onLine(`$ ${cmd} ${args.join(' ')}`);
    const r = await exec(cmd, args, { env, onLine });
    if (r.code === 127 && cmd === 'uv') throw new Error('uv not found: install uv (https://docs.astral.sh/uv/getting-started/installation/), then rerun');
    if (r.code !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${r.code}): ${r.stderr.trim().slice(-1500)}`);
  };
  await mkdir(l.dir, { recursive: true });
  await rm(l.marker, { force: true });
  if (!(await exists(l.python))) await run('uv', ['venv', '--managed-python', '--python', '3.12', join(l.dir, 'venv')]);
  await run('uv', ['pip', 'install', '--python', l.python, '--torch-backend', 'cpu', ...PACKAGES]);
  await run(l.python, [l.worker, 'prefetch', l.modelDir, MODEL_REVISION]);
  await writeFile(l.marker, JSON.stringify({ kokoro: KOKORO_VERSION, revision: MODEL_REVISION, installedAt: new Date().toISOString() }, null, 2) + '\n');
  return l;
}

if (import.meta.main) {
  const l = await installKokoro(dataPaths(defaultHome()), (line) => console.log(line));
  console.log(`Kokoro installed in ${l.dir}`);
}
