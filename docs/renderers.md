# Renderers

A renderer turns a timed scene plan plus a style (DESIGN.md) into an output file. Every renderer implements `Renderer` in `src/providers/types.ts`, is registered in `RENDERERS` in `src/providers/registry.ts`, and passes the shared contract in `test/contracts/renderer.ts`. Pick the video renderer on the Settings page.

## HyperFrames

Renders narrated video with HeyGen's [HyperFrames](https://github.com/heygen-com/hyperframes): HTML + CSS + GSAP compositions rendered frame by frame in headless Chrome to MP4.

**License:** HyperFrames is Apache-2.0 (source: https://github.com/heygen-com/hyperframes). Nothing from it is committed to this repo; it is installed into a local cache on first use. GSAP, which compositions use for animation, is installed alongside it under GSAP's own "Standard no charge" license (https://gsap.com/standard-license).

**Code:** `src/providers/hyperframes/` (`renderer.ts`, `toolchain.ts`, `prompt.ts`, `checks.ts`, `setup.ts`).

### Install

The toolchain lives under the data dir, not in the app's `package.json`, and is shared by all renders:

```
<data dir>/cache/hyperframes/<version>/
  node_modules/   npm install of hyperframes and gsap (pinned versions)
  skills/         HyperFrames' agent skills, from the GitHub release of the same version
  ready.json      written last; means "installed"
```

It installs automatically on the first HyperFrames render (about 125 MB of npm packages plus a one-time download of the release tarball for the skills). To install ahead of time, run `node src/providers/hyperframes/setup.ts` (respects `EXPLAINER_HOME`). `explainer doctor` checks npm, the toolchain and a Chrome for rendering when HyperFrames is the selected video renderer.

The HyperFrames CLI finds Chrome itself (`HYPERFRAMES_BROWSER_PATH`, then its own download cache in `~/.cache/hyperframes`, then system Chrome) and downloads `chrome-headless-shell` there if none is found. Telemetry, update checks and global skill installs are turned off for every CLI call.

The pinned version is `HYPERFRAMES_VERSION` in `toolchain.ts`. Bumping it installs a fresh `<version>` dir; the skills always match the CLI that renders.

### How a render works

1. Each scene is keyed by its stable scene ID. Clean scenes (not in `dirtyScenes`) are copied from `cacheDir/scene-<id>.mp4`.
2. For each dirty scene, a per-render, per-attempt project dir `scenes/<id>/attempt-<n>/` gets `DESIGN.md`, a local `gsap.min.js`, and HyperFrames' skills in `.claude/skills/`, where `claude -p` running in that dir finds them.
3. An agent task (kind `hyperframes-scene`, file tools only, `expectFiles: ['index.html']`) writes one standalone composition. Our prompt gives the task, the file contract and the style; how to write HyperFrames compositions comes from HyperFrames' skills.
4. `hyperframes lint`, then `hyperframes render --strict` at 1920x1080, 30 fps.
5. ffmpeg muxes the scene's narration and normalizes the clip (H.264 yuv420p, 30 fps, 48 kHz stereo AAC, exact scene length) to `scene-<id>.mp4`.
6. If lint, render or the agent fails, the scene is retried once with the error and the failed file fed back to a new agent task; a second failure fails the render with that error.
7. Clips are concatenated (stream copy) into `output.mp4`.

### Tests

`LIVE=1 node --test test/api/contract-renderer.test.ts` runs the shared contract against the real toolchain, with the fake agent supplying a minimal composition per scene (no model needed). Its toolchain cache defaults to `<tmpdir>/rocket-explainer-live`, or `EXPLAINER_HOME` when set.
