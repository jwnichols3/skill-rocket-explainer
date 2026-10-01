import { join } from 'node:path';
import { ffmpeg } from '../../src/media.ts';

/** Generated test media in `dir`: ref.png (solid colour) and clip.mp4 (10 s, hard cuts at 2.5, 5 and 7.5 s). */
export async function makeReferenceMedia(dir: string): Promise<void> {
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x0b0f14:s=320x180', '-frames:v', '1', join(dir, 'ref.png')]);
  const inputs = ['testsrc', 'smptebars', 'color=c=red', 'testsrc2'].flatMap((s) => ['-f', 'lavfi', '-i', `${s}${s.includes('=') ? ':' : '='}d=2.5:s=1280x720:r=25`]);
  await ffmpeg([...inputs, '-filter_complex', '[0][1][2][3]concat=n=4:v=1:a=0[v]', '-map', '[v]', '-pix_fmt', 'yuv420p', join(dir, 'clip.mp4')]);
}
