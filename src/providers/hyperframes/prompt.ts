import { SCENE_SKILLS } from './toolchain.ts';

export const SCENE_FILE = 'index.html';

/**
 * The scene task's prompt: the task, the file contract and the style. HOW to write a HyperFrames
 * composition is deliberately not here; it comes from HyperFrames' own skills, installed in the
 * agent's working directory under .claude/skills/.
 */
export function scenePrompt(): string {
  return `You are writing one scene of a narrated explainer video as a HyperFrames composition (HTML + CSS + GSAP, rendered frame by frame to MP4 by the HyperFrames CLI).

## How to write it
HyperFrames' own agent skills are installed in this working directory under .claude/skills/ (${SCENE_SKILLS.join(', ')}). Use them as the authority on how to write the composition: load the hyperframes-core skill first (it may be listed as .claude:hyperframes-core; if skills are not available as tools, Read .claude/skills/hyperframes-core/SKILL.md and the references it points to, starting with references/minimal-composition.md and references/determinism-rules.md), then hyperframes-animation and hyperframes-keyframes for motion, and hyperframes-creative for layout and typography. Do not run the intent interview, write BRIEF.md or STORYBOARD.md, or route to a workflow: the brief is fixed below and this is a single-file job. You have no shell; the orchestrator lints and renders your file and re-dispatches you with any findings.

## Inputs (all in inputs.json in this directory)
- scene: id, title, narration (spoken by a voice-over, timed), visuals (what the scene shows), elements (style elements this scene must exercise), words (word timings in ms from the scene start), durationMs.
- width, height, fps, durationSeconds, compositionId.
- DESIGN.md in this directory is the style: YAML tokens (colors, typography, spacing, rounded, motion, camera) plus prose sections. Follow its Identity, Motion, Camera and Video sections; take every colour from its tokens.
- comments: reviewer notes on the previous render, when any. Address them.
- previousError, when present: the lint or render failure of your previous attempt, whose file is in previous-attempt.html.txt. Fix every finding.

## File contract
Write exactly one file: ${SCENE_FILE} in this directory, a standalone (top-level) HyperFrames composition:
- Root element: data-composition-id equal to compositionId, data-width/data-height equal to width/height, data-duration equal to durationSeconds exactly. The scene must fill exactly that duration: no early end, nothing past it.
- One paused GSAP timeline registered at window.__timelines[compositionId].
- Load GSAP only from the local file gsap.min.js already in this directory: <script src="gsap.min.js"></script>.
- No network: no CDN scripts, web fonts, remote images or fetches. Use generic or system font stacks (e.g. system-ui, sans-serif) unless a font file exists in this directory.
- Deterministic: no Math.random, Date, timers, requestAnimationFrame or infinite repeats.
- No <audio> or <video>: narration is muxed in afterwards.
- Visible text is short on-screen copy (titles, labels, stats), never the full narration. Time reveals to the word timings so the picture follows the voice.
Do not write any other file.`;
}
