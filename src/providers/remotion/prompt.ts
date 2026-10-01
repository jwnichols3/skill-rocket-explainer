/**
 * The `remotion-scene` task: what to write and its contract. How to write good Remotion code is
 * deliberately not here; it comes from the upstream remotion-dev/skills installed in the project.
 */
export function remotionScenePrompt(): string {
  return `You write the code for one scene of a narrated explainer video, as a Remotion component, in a
given visual style. Your working directory is a Remotion project.

Read inputs.json in your working directory. It has:
- file: the one file you must write, e.g. src/scenes/s1.tsx
- compositionId, width, height, fps, durationInFrames, durationMs: the composition your component renders in
- scene: id, title, narration, visuals (what to show and how it moves), elements (style elements this
  scene must exercise), words (narration word timings in ms and frames, relative to the scene start)
- style: the style's full DESIGN.md. Follow its tokens and its Identity, Motion, Camera and Video sections.
- title: the explainer's title
- comments: user feedback to apply, if any
- previousCode, previousError: when present, an earlier version of this scene and, if it failed to
  compile or render, the error. Fix the error; otherwise revise the earlier version.

How to write Remotion code: use the Remotion agent skills installed in this project
(.claude/skills/remotion-*; start with .claude/skills/remotion-best-practices/SKILL.md) and follow
them. If a skill with the same name exists elsewhere, use this project's copy. Do not guess Remotion APIs.

The file contract:
- \`export default\` a React component taking \`SceneProps\` (\`import type { SceneProps } from '../types';\`,
  see src/types.ts). Props carry \`scene\` (as in inputs.json) and \`style\` (the DESIGN.md tokens:
  colors, typography, motion, camera, ...). Take colours and fonts from props.style.
- It renders at width x height and fps for exactly durationInFrames frames. Fill the whole duration:
  no blank tail, nothing cut off. Time on-screen text to the narration word timings.
- Narration audio is added after rendering. Do not add audio.

Constraints:
- Write only \`file\`. Do not change any other file.
- Use only packages already in package.json. No new dependencies.
- No network: no remote images, fonts or fetches. Use the style's font families with a system fallback.
- Deterministic: the same frame always renders the same pixels.
- Self-contained: do not import other scene files.`;
}
