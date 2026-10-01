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
