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

## Deck

`html-deck` renders the `deck` output type: HTML slides for fidelity (`deck.html`, primary) and an
editable PowerPoint file (`deck.pptx`). Code: `src/providers/deck/`. Needs the headless browser
(`src/browser.ts`); `explainer doctor` checks it when `html-deck` is selected. The .pptx is written by
[pptxgenjs](https://github.com/gitbrent/PptxGenJS) (MIT, pure JS).

### How a render works

1. Each slide is a scene, keyed by its scene ID. Clean slides (not in `dirtyScenes`) are copied from
   `cacheDir/slides/<id>.*` and never go to the agent.
2. For each dirty slide, an agent task (kind `deck-slide`, file tools only, no shell) runs in
   `tasks/<id>/attempt-<n>/`, which holds `DESIGN.md`, `previous/` (this slide's last render, or the
   failed attempt on a retry) and `reference/slide.html` (the nearest earlier slide, for consistent
   chrome). `inputs.json` has the slide (title, body = the scene's narration, visuals), its index, the
   deck outline, comments, and `previousError` on a retry. `expectFiles`:
   - `slides/<id>.html`: a self-contained 1920x1080 page. Inline CSS, no `<script>`, no network
     (remote `src`/`href`/`url()`/`@import` are rejected), token fonts with system fallbacks.
   - `slides/<id>.json`: the slide model (below), in px on the same 1920x1080 slide.
3. Checks: the HTML rules above; the model validates (`model.ts`, with specific messages); and the
   page is loaded in headless Chromium at 1920x1080, where any text running past the slide edges is
   reported. Any problem sends the slide back to the agent once with the problems. After the retry:
   - HTML still invalid: the render fails with the problems.
   - Model still invalid: the PowerPoint slide becomes a full-slide picture of the HTML, and the log
     says so (`deck.pptx: slide s2 is a picture ...`).
   - Text still cut off: the slide is kept and the log says so.
4. `deck.html`: every slide is an isolated `srcdoc` iframe inside `<section class="slide" id="<id>">`,
   so slides' CSS never collides. One slide is shown at a time, scaled to fit the window. Navigation:
   arrow keys, space, PageUp/PageDown, Home/End, click (left third back, elsewhere forward) and the URL
   hash `#<id>` (read and written). On each change it posts `{ type: 'deck-slide', id, index, total }`
   to its parent. Printing gives one slide per page.
5. `deck.pptx` (16:9, 13.333x7.5 in): one slide per scene, built from the models; speaker notes are the
   model's `notes`, else the slide's body text.

### Slide model (`slides/<id>.json`)

```json
{
  "background": "background",
  "elements": [
    { "type": "text", "x": 120, "y": 96, "w": 1680, "h": 140, "text": "Title", "font": "display", "size": 88, "color": "text", "bold": true, "align": "left", "valign": "top" },
    { "type": "bullets", "x": 120, "y": 300, "w": 800, "h": 500, "items": ["One", "Two"], "font": "body", "size": 40 },
    { "type": "shape", "shape": "roundRect", "x": 1000, "y": 300, "w": 360, "h": 160, "fill": "surface", "line": "primary", "lineWidth": 4, "radius": 24, "text": "Label" },
    { "type": "line", "x1": 1360, "y1": 380, "x2": 1500, "y2": 380, "color": "accent", "width": 4, "arrow": "end" },
    { "type": "table", "x": 120, "y": 300, "w": 1680, "h": 400, "rows": [["Option", "Cost"], ["Queue", "$"]], "colW": [1000, 680], "header": true, "headerFill": "primary" },
    { "type": "snapshot", "x": 1000, "y": 520, "w": 800, "h": 400, "why": "gradient illustration" }
  ],
  "notes": "optional speaker notes"
}
```

Colours are DESIGN.md colour tokens or `#hex`; fonts are typography tokens (`display`, `body`, `mono`,
resolved to the token's family; weight >= 600 means bold) or family names. Sizes are px (1920 px =
960 pt). Every element becomes a native, editable PowerPoint object (text box, bulleted text box, preset
shape with optional text, connector line with arrowheads, table), except `snapshot`: that region of the
rendered HTML is captured as a PNG and placed as a picture. The prompt tells the agent to use it only
for what the other types can't express, and to keep important text out of it.

### Viewer

`web/js/viewers/deck.js` shows `deck.html` in a sandboxed iframe with Prev/Next and "Slide n / N".
It moves the deck by setting the iframe's hash, so `seek(scene)` (the scene chips) jumps to a slide, and
it follows the deck's `deck-slide` messages so in-deck navigation keeps the index in sync. Links to
`deck.html` and `deck.pptx` sit under it.

### Tests

- `test/api/contract-renderer.test.ts`: the shared contract with the fake agent supplying slides (no
  model; uses the headless browser like `test/api/browser.test.ts`). With `LIVE=1`, the same contract runs
  a 3-slide deck with a real model through `claude-subscription`.
- `test/api/deck-renderer.test.ts`: one section per slide, .pptx slides with native text/shapes in token
  colours and fonts, dirty-only re-render with reuse, the retry, the picture fallback, the cut-off check,
  and the build/comment/re-render and style deck-sample loops in the app.
- `test/e2e/deck-viewer.spec.ts`: Prev/Next, scene-chip seek and in-deck navigation sync, against the
  real renderer with the fake agent.

The fake agent's `deck-slide` responder understands `[fake: broken once]` (invalid model on the first
attempt) and `[fake: no model]` (never valid) in a slide's visuals.
