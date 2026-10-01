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

## Briefing doc

Renderer `markdown-pdf` (output type `doc`): a narrative briefing doc as Markdown, rendered to a styled PDF. Select it with `providers.renderer.doc = "markdown-pdf"`.

**Code:** `src/providers/doc/` (`renderer.ts`, `markdown.ts`, `stylesheet.ts`, `prompt.ts`). **Viewer:** `web/js/viewers/doc.js`.

**Needs:** a headless Chromium (`npx playwright install chromium`, or Google Chrome); `explainer doctor` checks it when this renderer is selected. Markdown is parsed with [marked](https://github.com/markedjs/marked) (MIT, no dependencies, GFM tables built in).

### Output

- `doc.pdf` (primary) and `doc.md`. Explainer rounds store them as `doc.pdf` + `doc.md`, style samples as `sample.pdf` + `sample.md`; export copies both.
- `doc.md` is assembled deterministically from the script: `# <title>`, then one `## ` section per scene, in order, with the body text (the scene's narration) and then its figures. Each heading carries an inline anchor, `## <a id="s2"></a>Packets`: valid CommonMark, invisible on GitHub, and the stable section target. `#`/`##` headings inside body text are demoted to `###`; raw HTML in body text is shown as text.
- The work dir also keeps `doc.html` (what was printed), `doc.css` + `doc.css.json` (stylesheet and its style hash/source) and `figures.json` (per-section figures and content hashes), which later rounds reuse through `cacheDir`.

### How a render works

1. **Stylesheet** (agent task `doc-stylesheet`, file tools only, `expectFiles: ['doc.css']`). Inputs: `style` (full DESIGN.md), `docRules` (its `## Doc` section), `previousError` on a retry; the work dir also has `structure.html`, the real doc in the fixed HTML structure (`body.doc`, `header.doc-cover > h1.doc-title`, `nav.doc-toc`, `main.doc-body > section.doc-section[data-scene] > h2 ...`, blockquote callouts, GFM tables). The agent writes `@page` size/margins, margin-box headers/footers (`"__DOC_TITLE__"` is replaced with the title), type scale, headings, callouts, tables and colours from the tokens. Rejected if empty, over 200 KB, without `@page`, or loading anything remote. Cached by a hash of the style text: reused from the previous round's `cacheDir`, or from `<data dir>/cache/doc-stylesheets/<hash>.css` across explainers. A failure is retried once with the error; after a second failure (or with no agent) a deterministic stylesheet derived from the tokens is used (paper = the lighter of `background`/`text`, ink = the darker, `primary`/`accent` on rules, callouts and table heads) and the next render tries the agent again.
2. **Figures** (agent task `doc-figures`, file tools only, `resultFile: 'result.json'`, run in parallel with the stylesheet). The script's `visuals` for a doc are directions ("a small table comparing ..."), so one task turns them into Markdown for the sections that need it: blockquote callouts, small GFM tables and short lists, from the section's own facts. Output `{ "sections": [{ "id", "markdown" }] }`. Figures are cached per section by a hash of title/narration/visuals and regenerated for dirty sections only. Fallback after two failures: the visuals text as a `> **Figure:** ...` callout.
3. Markdown -> HTML (marked) with a table of contents linking every section; that makes Chromium emit a named PDF destination per section ID.
4. HTML -> PDF with `src/browser.ts` `htmlToPdf` (print media, `@page` size wins, remote requests blocked).

Section text is final in the script, so the whole doc is regenerated each time (a couple of seconds); `rendered` reports `dirtyScenes`, or every section on a full build. Section-pinned comments revise that section's script (generic pipeline), which re-runs only that section's figures.

### Viewer

The PDF in an iframe, with a PDF / Markdown toggle (the Markdown view shows `doc.md` as text). Section chips seek: the PDF reopens at `#nameddest=<sceneId>` (Chrome's built-in PDF viewer), the Markdown view scrolls to and highlights the section's `## ` line. Links to every file of the round.

### Tests

`test/api/contract-renderer.test.ts` runs the shared contract for `markdown-pdf` (real Chromium, fake agent supplying `doc.css` and figures). `test/api/doc-renderer.test.ts` covers section order and anchors, the style's colours in the printed HTML/CSS, named destinations, pagination of a long doc, retry and fallback, stylesheet and figure caching, sanitising, and an explainer build/re-render plus a style doc sample through the app. `test/e2e/doc-viewer.spec.ts` covers the toggle and seeking.
