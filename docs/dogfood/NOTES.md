# Dogfood run (#24): this repo, explained in the Hitchhiker's Guide style

Date: 2026-10-01.
- **Sources:** `docs/intent/explainer.md` and `docs/research/prior-art.md`.
- **Brief:** "What Rocket Explainer is, why styles are the product, and how the style loop works. A short
  overview."
- **Style:** the seed Hitchhiker's Guide, unchanged.
- **Providers:** real Claude (subscription, Opus 5.5 high), real Polly (Brian, generative) and the real
  renderers.
- **How it ran:** each type went report, then plan, then approve, then build, then one comment pinned to
  scene/section s2, then a re-render. Driven through the app's API by `scripts/live-explainer.ts`; files
  here are the round-2 outputs.

## Fresh install and live suites (v0.1.0)

- **Install.** Downloaded the `v0.1.0` release with `gh` (the repo was private), ran
  `EXPLAINER_TARBALL=… sh install.sh` into the default locations on a Mac with nothing installed, then
  `explainer setup --yes`. Setup saved real-provider defaults (video on HyperFrames). `explainer doctor` flagged
  one gap, the HyperFrames toolchain ("installs on the first render"); its printed fix installed it, and every
  check then passed.
- **Live contract suites** (`LIVE=1`) ran against the installed code: the release's `src/` plus the tag's `test/`.
  - Passed: Claude subscription and Bedrock agent surfaces, Polly, Kokoro, and the Remotion, HyperFrames, deck,
    doc and visual renderers.
  - Kokoro failed until its documented one-time install had run, then passed.
  - ElevenLabs was skipped: no API key. It is tested against a mock only.
  - The installer and public-readiness tests need a git checkout, so they were run on the tagged commit
    instead, where they passed. CI and the release workflow also ran them.
- **Update.** `v0.1.1` was then installed from Settings > Check for update, then Restart now, going from 0.1.0
  to 0.1.1 in place.

| Output | Files | Shape | Timings | Notes |
|---|---|---|---|---|
| Video | `video.mp4` (720p copy of a 1080p render) | 5 scenes, 36.4 s | report 46 s, plan 40 s, build 27.7 min, re-render 5 min | **HyperFrames**, the new default, run from the v0.1.0 install with no renderer override. The comment "make the highlight on the key term bigger and hold it a beat longer" re-rendered only s2. Scene 4 opens with a literal dive-through into the STYLE box, which the bakeoff asked for (about 0.5 s of solid green as the camera passes through it), and the style loop builds inside it. Cost at API list prices: agent runs $7.51 (report $0.24, plan $0.18, build $5.91 over 6 runs, re-render $1.17 over 2), Polly 428 characters, about $0.01. |
| Video (earlier) | `video-remotion.mp4` | 5 scenes, 45.6 s | report 40 s, plan 40 s, build 31 min, re-render 2.9 min | Remotion, before the #10 pick. On style throughout: title assembles, the `/explainer` command types itself, sources flow through to the four outputs, and the style card shows v1/v2/v3 tabs. The asides are dry ("*This video is wearing one right now."). The re-render redid only s2 and kept the narration. The build time is inflated: it ran alongside four bakeoff renders and three other builds. |
| Deck | `deck.html`, `deck.pptx` | 6 slides | report 46 s, plan 40 s, build 10 min, re-render 1.8 min | Slides are native, editable PowerPoint objects (text boxes, shapes, tables), not pictures. The re-render regenerated only slide s2. |
| Briefing doc | `doc.pdf`, `doc.md` | 5 sections, 7 pages | report 48 s, plan 50 s, build 2.7 min, re-render 44 s | The Doc section's light variant: cover band, contents, mono labels, callouts and tables. |
| Visual | `visual.png` (3200x7474 at 2x), `visual.html` | 6 panels | report 44 s, plan 42 s, build 10.5 min, re-render 5.2 min | A dense poster on the dark palette, with real diagrams (the style loop as a cycle, a style's anatomy) and the closing line "That loop is the product." Defect: in the loop diagram, the "RENDER ~10 s SAMPLE" label collides with its icon row. One more comment round should fix it. |

## What this run taught us

- The pipeline holds up on real providers for all four types, and partial re-render works on each.
- Style fidelity across types is good: the video, deck and visual share one look, and the doc takes the
  light variant the style asks for.
- Video build time is dominated by per-scene agent work (about 1-3 min per scene on Opus). Scene agents run
  one at a time. Running dirty scenes in parallel is the obvious speed-up.
- The visual's one layout collision suggests the visual renderer's checks should also look for overlapping
  text boxes, not only edge overflow.
