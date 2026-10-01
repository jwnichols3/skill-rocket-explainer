# Renderers

A renderer turns a plan (style + timed scenes) into an output file. Pick one per output type in
settings (`providers.renderer.<type>`). Every renderer passes the shared contract in
`test/contracts/renderer.ts`.

## Remotion (`remotion`, video)

An agent writes one Remotion component per scene; Remotion renders each scene to its own clip; ffmpeg
adds the narration and joins the clips into `output.mp4`.

### Setup

The Remotion project template lives in `templates/remotion/` (its own `package.json` and lockfile,
pinned to Remotion 4.0.532; none of it is an app dependency). On the first Remotion render, or when
you run `node src/providers/remotion/setup.ts`, the app installs it once into
`<data dir>/cache/remotion-project/`:

1. `npm ci` from the template's lockfile.
2. The upstream Remotion agent skills, the official way:
   `npx skills add remotion-dev/skills --skill '*' --agent claude-code --copy -y`. They land in the
   project's `.claude/skills/`, so an agent working in the project finds them as project skills.
   They are fetched from GitHub at setup time and never committed here.
3. `npx remotion browser ensure`: Remotion's own Chrome Headless Shell.

The cache reinstalls itself when the template changes. Needs network the first time.
`explainer doctor` reports the project, the skills and the browser (as warnings while not yet installed).

### A render

Everything happens inside the render's workdir:

- `project/` is a copy of the cached project (sources and skills copied, `node_modules` linked to
  the cache). Temporary files go to `tmp/` (removed afterwards).
- Each dirty scene gets an agent task (kind `remotion-scene`, file tools plus `Skill`, no shell) with
  the project as its workdir. `inputs.json` carries the file to write (`src/scenes/<id>.tsx`), the
  composition size, fps and frame count, the scene (narration, visuals, elements, word timings), the
  full DESIGN.md, comments, and the previous code and error when there is one. The prompt states the
  task and the file's contract; how to write Remotion code comes only from the upstream skills.
- One composition per scene, ID `scene-<id>`, 1920x1080 at 30 fps, exactly as long as the scene's
  narration in the time map. `src/manifest.json` and `src/scenes/index.ts` are generated per pass.
- `render.mjs` (in the template) bundles once and renders each composition with `@remotion/renderer`
  (H.264, BT.709, muted). A scene whose code fails to compile or render goes back to the agent once
  with the error; a second failure fails the job with that error.
- ffmpeg muxes each scene's narration (AAC 48 kHz stereo, padded or trimmed to the video) into
  `scene-<id>.mp4`, then concatenates all scenes into `output.mp4`.
- With `cacheDir` and `dirtyScenes`, clean scenes reuse the previous `scene-<id>.mp4` (and their
  code), and only dirty scenes go to the agent and Remotion.

The contract runs against Remotion with the fake agent supplying scene code (opt-in, needs the
toolchain and network for the first install):

```
LIVE=1 node --test test/api/contract-renderer.test.ts
```

Set `EXPLAINER_REMOTION_CACHE` to choose where the test installs the project (default: the OS temp dir).

### License

Remotion is not open source. It is free for individuals, for-profit organisations with up to 3
employees, non-profits and evaluation. Larger organisations need a Company License: per-seat for
people writing Remotion code (including with coding agents), and an "Automators" plan for code that
renders, at $0.01 per render with a $100/month minimum. This app's render loop counts as automation.
Studio and Player previews are not billed renders. Check the current terms before using this at work:
https://www.remotion.dev/docs/license/faq and https://www.remotion.pro/license
(see also `docs/research/prior-art.md`, section 2).
