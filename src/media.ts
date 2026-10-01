import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';

export interface ExecResult { code: number; stdout: string; stderr: string }

/** Run a command with stdin closed. Never throws on non-zero exit; callers decide. */
export function exec(cmd: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; onLine?: (l: string) => void; timeoutMs?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal });
    } catch (err: any) {
      resolve({ code: 127, stdout: '', stderr: String(err?.message ?? err) });
      return;
    }
    let stdout = '', stderr = '';
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs);
    const lines = (buf: string, chunk: string) => {
      if (!opts.onLine) return buf + chunk;
      const all = buf + chunk;
      const parts = all.split('\n');
      for (const l of parts.slice(0, -1)) opts.onLine(l);
      return parts[parts.length - 1];
    };
    let outBuf = '', errBuf = '';
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; outBuf = lines(outBuf, s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; errBuf = lines(errBuf, s); });
    child.on('error', (err: any) => { if (timer) clearTimeout(timer); resolve({ code: err.code === 'ENOENT' ? 127 : 1, stdout, stderr: stderr + String(err.message) }); });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (opts.onLine) { if (outBuf) opts.onLine(outBuf); if (errBuf) opts.onLine(errBuf); }
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/** Media duration in ms via ffprobe. */
export async function probeDurationMs(file: string): Promise<number> {
  const r = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  if (r.code !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  return Math.round(parseFloat(r.stdout.trim()) * 1000);
}

export async function probeStreams(file: string): Promise<string[]> {
  const r = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file]);
  if (r.code !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Write a silent 16-bit mono PCM WAV of the given length. */
export async function writeSilentWav(file: string, durationMs: number, sampleRate = 16000): Promise<void> {
  const samples = Math.round((durationMs / 1000) * sampleRate);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  await writeFile(file, buf);
}

export async function ffmpeg(args: string[], opts: { cwd?: string; signal?: AbortSignal } = {}): Promise<void> {
  const r = await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], opts);
  if (r.code !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${r.stderr.trim().slice(-2000)}`);
}
