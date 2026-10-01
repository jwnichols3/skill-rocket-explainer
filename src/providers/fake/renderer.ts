import { copyFile, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Renderer, RenderRequest, RenderResult } from '../types.ts';
import { ffmpeg } from '../../media.ts';

function colorFor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return '0x' + (h & 0xffffff).toString(16).padStart(6, '0');
}

async function exists(f: string) { try { await access(f); return true; } catch { return false; } }

/** Tiny real MP4s (one flat colour per scene) with the scenes' audio. For tests. */
export function createFakeVideoRenderer(): Renderer {
  return {
    id: 'fake',
    label: 'Fake renderer (for tests)',
    outputTypes: ['video'],
    async render(req: RenderRequest): Promise<RenderResult> {
      await mkdir(req.workdir, { recursive: true });
      const rendered: string[] = [];
      const clips: string[] = [];
      for (const scene of req.scenes) {
        const clip = join(req.workdir, `scene-${scene.id}.mp4`);
        const cached = req.cacheDir ? join(req.cacheDir, `scene-${scene.id}.mp4`) : '';
        const dirty = !req.dirtyScenes || req.dirtyScenes.includes(scene.id);
        if (!dirty && cached && await exists(cached)) {
          if (cached !== clip) await copyFile(cached, clip);
        } else {
          const secs = (scene.durationMs / 1000).toFixed(3);
          const audio = scene.audioFile ? ['-i', scene.audioFile] : ['-f', 'lavfi', '-t', secs, '-i', 'anullsrc=r=16000:cl=mono'];
          await ffmpeg(['-f', 'lavfi', '-i', `color=c=${colorFor(scene.id)}:s=320x180:r=10:d=${secs}`, ...audio,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '44100', '-ac', '1', '-t', secs, clip], { signal: req.signal });
          rendered.push(scene.id);
          req.onLog?.(`rendered scene ${scene.id} (${secs}s)`);
        }
        clips.push(clip);
      }
      const list = join(req.workdir, 'concat.txt');
      await writeFile(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
      const out = join(req.workdir, 'output.mp4');
      await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', out], { signal: req.signal });
      const durationMs = req.scenes.reduce((s, x) => s + x.durationMs, 0);
      return { primary: out, files: [out], durationMs, sceneCount: req.scenes.length, rendered };
    },
  };
}
