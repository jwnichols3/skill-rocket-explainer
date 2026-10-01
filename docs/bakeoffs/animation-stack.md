# Bakeoff: animation stack (#10)

Which video renderer becomes the default: **Remotion** or **HyperFrames**? The second question is whether
**Opus 5.5** reaches the **Fable 5.1** bar once the style instructions are good.

## Setup

- **Style:** the seed Hitchhiker's Guide style (`seed/styles/hitchhikers-guide/DESIGN.md`), authored from
  the intent's description only.
- **Per model** (Opus 5.5 high and Fable 5.1 high):
  - Each model runs the style-sample step once: it refines the style and plans the ~10 s sample.
  - Real Polly narrates that plan once, with the seed voice (Brian, generative).
- **Per stack:** the same plan and the same narration are rendered by Remotion and by HyperFrames, and the
  same model writes the scene code. That gives 4 renders from 2 plans.
- **Rendering:** real `claude -p` (subscription surface), real Polly, real renderers.

## Judging criteria (written before judging)

Each criterion is scored 1-5, where 5 is best.

| # | Criterion | Weight | What a 5 looks like |
|---|---|---|---|
| 1 | Style fidelity | 3 | Unmistakably the seed style: near-black, neon green/blue, acid-yellow highlights, high contrast, flat geometric vectors, blueprint grid. |
| 2 | Motion quality | 3 | Smooth, eased, purposeful motion: pop-overshoot entrances, staggered groups, line draw-ons, no jank, cuts or dead frames. |
| 3 | Camera | 2 | Visible, smooth camera moves every scene; a dive-through or pull-back that connects scenes. |
| 4 | Sync with narration | 2 | Highlights and pop-ups land on the words that name them, and nothing appears long before or after. |
| 5 | Element coverage | 1 | Opening, transition, text pop-ups, boxes, diagram and camera movement all clearly present. |
| 6 | Legibility and polish | 2 | Text readable at 1080p, inside the safe area, nothing clipped or overlapping, consistent spacing. |
| 7 | Humour and tone | 1 | One dry aside that lands; never at the expense of clarity. |

Quality total = sum of score x weight, out of 70.

Operational measures (reported, not scored): render wall time, agent cost, retries, failures, and
licensing (Remotion company licence vs HyperFrames Apache-2.0).

**Judge pass.** One blind pass by Opus 5.5 (high effort) over frames sampled every 0.5 s from each render,
plus the scene plan and narration. Renders are labelled A-D in random order, and the judge does not know
which stack or model made which. Rocket makes the final call by watching the four MP4s.

## Runs (2026-10-01)

`scripts/stack-bakeoff.ts`; judge `scripts/stack-judge.ts`. All four renders succeeded on the first try,
with no scene failures. Both plans came out at 15-17 s, not ~10 s; the style-sample prompt should hold the
length tighter.

| Render | Model | Stack | Video | Render time | Scene-code agents | Plan |
|---|---|---|---|---|---|---|
| A | Opus 5.5 high | HyperFrames | 17.2 s | 13.1 min | $2.95 (3 tasks) | $0.21 |
| B | Opus 5.5 high | Remotion | 17.2 s | 14.5 min | $3.19 (3 tasks) | $0.21 |
| C | Fable 5.1 high | HyperFrames | 15.0 s | 28.6 min | $14.55 (4 tasks) | $0.65 |
| D | Fable 5.1 high | Remotion | 14.9 s | 20.6 min | $8.91 (4 tasks) | $0.65 |

The four runs ran in parallel on one Mac, so wall times are inflated and best read relatively. Costs are
Claude Code's own figures, also on the subscription. Watch each one: `animation-stack/<model>-<stack>.mp4`
(720p copies). Contact sheets: `animation-stack/<model>-<stack>-sheet.png`.

## Judge scores (blind, Opus 5.5 high, frames every 0.5 s)

| Render | Style x3 | Motion x3 | Camera x2 | Sync x2 | Coverage x1 | Polish x2 | Humour x1 | **Total /70** |
|---|---|---|---|---|---|---|---|---|
| A Opus · HyperFrames | 5 | 4 | 4 | 4 | 5 | 4 | 5 | **61** |
| B Opus · Remotion | 4 | 4 | 4 | 3 | 5 | 4 | 3 | **54** |
| C Fable · HyperFrames | 3 | 3 | 5 | 4 | 5 | 3 | 4 | **51** |
| D Fable · Remotion | 3 | 3 | 4 | 4 | 4 | 2 | 4 | **46** |

The full rationale per render is in `animation-stack/judge.json`. In short:

- **A** was the closest to the seed: palette, grid, and yellow used only for "look here", timed to the words.
  It had a real branching router diagram and the best humour (the packets read SO LONG / AND THANKS / FOR
  ALL / THE FISH, and packet 3 arrives late on "Usually in order"). It was let down by black-frame
  transitions and some edge clipping.
- **B** had the same plan as A, with weaker typography, placeholder packet content, and reassembly about
  1 s late. The same plan on two stacks gave different scene code, so the stack's agent skills matter.
- **C** had the best camera of the four: true dive-throughs into the O of the title and into a router node.
  It lost points on style fidelity (the grid is barely visible) and on continuity jumps.
- **D** shared C's camera ideas but had the worst composition: clipped, overlapping, lopsided.

## Licensing

- **Remotion:** free for individuals and companies of up to 3 people. Larger organisations need a Company
  License: "Creators" at $25/seat/month, or "Automators" (code that calls the renderer, which this app does)
  at $0.01 per render with a $100/month minimum. Sources are in `docs/research/prior-art.md`.
- **HyperFrames:** Apache-2.0. GSAP, which HyperFrames compositions use, has its own no-charge licence.
- This matters for the later specialised version used at work.

## Recommendation

**Make HyperFrames the default video renderer, with Opus 5.5 high as the default model.** Keep Remotion
installed and selectable.

- A won on quality, and the stacks' gap with the same plan was 7 points in HyperFrames' favour.
- HyperFrames was also slightly faster and cheaper here, and it carries no licence cost at any company size.
- Opus 5.5 beat Fable 5.1 on this style at about a quarter of the cost. Fable's camera ideas were better, so
  the next refinement round of the seed style should ask for literal dive-throughs (into a letter, into a
  node), which Opus followed less literally.

Caveats:
- This is one render per cell, and the judge is a model.
- Rocket should watch A-D before deciding.
- The decision is proposed in `docs/adr/0002-default-video-renderer.md`. The default in settings will
  switch when Rocket picks.
