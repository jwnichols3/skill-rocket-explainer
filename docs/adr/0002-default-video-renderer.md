# 2. Default video renderer and model

Status: **Accepted** by Rocket, 2026-10-01. Evidence: `docs/bakeoffs/animation-stack.md`.
Date: 2026-10-01

## Context

Both animation stacks run behind the renderer interface and pass the shared contract. The seed style's
sample was rendered on Remotion and on HyperFrames, each with Opus 5.5 and Fable 5.1, and judged blind
against criteria written before any render.

## Decision

- The default video renderer is **HyperFrames**. Remotion stays installed and selectable in Settings.
- The default model stays **Opus 5.5 at high effort**, with Fable 5.1 in the dropdown.

## Consequences

- No Remotion Company License exposure by default, which matters for the later work version.
- The settings default `providers.renderer.video` is `hyperframes`. Existing installs keep whatever they saved.
- Seed-style refinement should ask for literal dive-through transitions, where Fable did better.
