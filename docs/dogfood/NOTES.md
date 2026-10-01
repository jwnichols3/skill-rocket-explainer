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

**Not yet done for #24:** a fresh install from a GitHub release (no release exists yet; see #23) and the
live contract suites from that install. Those need a tag and Rocket's go-ahead.

| Output | Files | Shape | Timings | Notes |
|---|---|---|---|---|
| Video | `video.mp4` (720p copy of a 1080p render) | 5 scenes, 45.6 s | report 40 s, plan 40 s, build 31 min, re-render 2.9 min | Remotion. On style throughout: title assembles, the `/explainer` command types itself, sources flow through to the four outputs, and the style card shows v1/v2/v3 tabs. The asides are dry ("*This video is wearing one right now."). The re-render redid only s2 and kept the narration. The build time is inflated: it ran alongside four bakeoff renders and three other builds. |
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
