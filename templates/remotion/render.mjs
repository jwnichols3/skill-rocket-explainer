// Renders compositions of this project to silent MP4s. Run by Rocket Explainer from the project dir:
//   node render.mjs job.json
// job.json: { "entry": "src/index.ts", "bundleDir": "build", "compositions": [{ "id": "scene-s1", "out": "/abs/scene.mp4" }] }
// stdout carries one JSON event per line: bundled, progress, rendered, render-error, bundle-error, done.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';

const job = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\n');
const { cancelSignal, cancel } = makeCancelSignal();
let cancelled = false;
process.on('SIGTERM', () => {
  cancelled = true;
  cancel();
  setTimeout(() => process.exit(130), 3000).unref();
});

await ensureBrowser();

let serveUrl;
try {
  serveUrl = await bundle({ entryPoint: resolve(job.entry), outDir: resolve(job.bundleDir), enableCaching: false });
  emit({ type: 'bundled' });
} catch (err) {
  emit({ type: 'bundle-error', message: String(err?.stack ?? err) });
  process.exit(2);
}

let failed = 0;
for (const c of job.compositions) {
  if (cancelled) break;
  try {
    const composition = await selectComposition({ serveUrl, id: c.id, inputProps: {} });
    let lastStep = -1;
    await renderMedia({
      // bt709: standard yuv420p/BT.709 output (the default tags full-range JPEG colour and embeds an ICC profile).
      composition, serveUrl, codec: 'h264', colorSpace: 'bt709', outputLocation: c.out, muted: true, inputProps: {}, cancelSignal,
      onProgress: ({ progress }) => {
        const step = Math.floor(progress * 4);
        if (step > lastStep) { lastStep = step; emit({ type: 'progress', id: c.id, progress }); }
      },
    });
    emit({ type: 'rendered', id: c.id });
  } catch (err) {
    failed++;
    emit({ type: 'render-error', id: c.id, message: String(err?.stack ?? err) });
  }
}
emit({ type: 'done', failed, cancelled });
process.exit(cancelled ? 130 : 0);
