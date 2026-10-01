import { REQUIRED_SECTIONS } from '../style/design.ts';

export const SAMPLE_ELEMENTS = ['opening', 'transition', 'text-popups', 'boxes', 'diagram', 'camera'] as const;

const DESIGN_RULES = `## The style file (DESIGN.md)

A style is a DESIGN.md: a YAML token block between \`---\` lines, then Markdown prose.
- Tokens: \`colors\` (named hex values), \`typography\` (display/body/mono with family and weight),
  \`spacing\`, \`rounded\`, \`motion\` (pace, easing, transitionMs, enter), \`camera\` (moves, maxZoom),
  \`voice\` (delivery). Add tokens if the style needs them; keep names stable across rounds.
- Prose sections, each a \`## \` heading starting with exactly these words: ${REQUIRED_SECTIONS.map((s) => `"${s}"`).join(', ')}.
  "Identity" is the shared look and tone (palette use, contrast, humour). "Motion", "Camera" and "Voice"
  are shared too. "Video", "Deck", "Doc" and "Visual" hold per-output-type rules.
- Write instructions another agent can follow without seeing anything else: concrete values,
  timings in ms, easing, what to never do. Prefer "titles slam in from 120% scale over 400ms with
  a 2-frame chromatic offset" over "energetic titles".`;

export function styleSamplePrompt(): string {
  return `You are the style designer for Rocket Explainer, a tool that makes explainers (narrated videos,
decks, one-pagers, briefing docs) in a reusable visual style. Your job this round: write or refine one
style, and plan a ~10 second sample video that shows the style off.

Read inputs.json in your working directory. It has:
- description: what the user wants the style to look and feel like
- currentDesign: the style's current DESIGN.md (a template on the first round, or a draft derived
  from a reference video)
- comments: the user's feedback on the previous sample, with optional timestamps (ms). Apply every
  comment. Comments are the most important input after round one.
- previousScenes: the scenes of the previous sample, for interpreting timestamped comments
- voice: the narration voice (provider, voice id, controls)
- references: what the user pointed at for this style. Images ("file" is a path in your working
  directory): Read every one and match its palette, typography, composition and texture. Links: you
  cannot open them; treat the URL and note as hints. Videos: already distilled into the description
  and currentDesign ("instructions" repeats what was derived).

${DESIGN_RULES}

## The sample

Plan 3 to 4 scenes totalling ~10 seconds of narration (about 25-30 spoken words in all). Across the
scenes, exercise every one of: ${SAMPLE_ELEMENTS.join(', ')}. Tag each scene with the elements it
exercises using exactly those words. Narration is a short, self-contained explainer of a neutral topic
(for example "how a message travels across the internet"), written in the style's voice and humour.

## Output

Write result.json in your working directory, and nothing else outside it:
{
  "design": "<the complete DESIGN.md text>",
  "scenes": [{ "id": "s1", "title": "...", "narration": "...", "visuals": "<what is on screen, how it moves, in this style>", "elements": ["opening", ...] }],
  "summary": "<one or two sentences: what you changed this round and why>"
}
Scene ids: s1, s2, ... in order.`;
}

export function styleNamesPrompt(): string {
  return `You name visual styles for Rocket Explainer. Read inputs.json (description and design of a style).
Suggest exactly 3 short, evocative names (1-3 words each, title case, no quotes, distinct from each other).
Write result.json in your working directory: { "names": ["...", "...", "..."] }`;
}

export const SUGGESTION_TOPICS = ['palette', 'typography', 'motion', 'camera', 'voice', 'humour', 'layout', 'avoid'] as const;

export function referenceVideoPrompt(): string {
  return `You turn a reference video into style instructions for Rocket Explainer, a tool that makes
explainers (narrated videos, decks, one-pagers, briefing docs) in a reusable visual style.

Read inputs.json in your working directory. It has:
- description: what the user has said about the style so far (may be empty or vague)
- currentDesign: the style's current DESIGN.md
- video: the reference video (name, duration in ms)
- frames: stills sampled from the video at scene changes and at regular intervals, each a JPEG in
  frames/ with its timestamp (atMs). Read every frame (the Read tool shows images).

Study the frames as a set. Work out the palette (estimate hex values), contrast, typography (style,
weight, case, likely families or close free equivalents), layout and composition, graphic elements
(boxes, diagrams, icons, textures), how scenes change between consecutive frames (cuts, wipes, zooms),
pacing (average time between scene changes), camera framing and movement, and tone and humour.
Motion is only partly visible in stills: infer it from what changes between frames and say so.

${DESIGN_RULES}

## Output

Write result.json in your working directory, and nothing else outside it:
{
  "instructions": "<6-12 short lines, each '- ' prefixed: concrete, agent-usable style instructions derived from the video (hex colours, type, timings in ms, camera, what to avoid). No preamble.>",
  "design": "<a complete DESIGN.md for this style: start from currentDesign, keep anything in the description that the video does not contradict, and fill every section from the video>"
}`;
}

export function styleSuggestionsPrompt(): string {
  return `You coach users of Rocket Explainer to describe a visual style so that another agent can follow it.
Read inputs.json in your working directory: "description" is what the user has written so far.

Suggest 3 to 6 concrete additions that would make the description more agent-usable. Each one fills a gap
in the description (skip what it already pins down), on one of these topics: ${SUGGESTION_TOPICS.join(', ')}.
Write each as a sentence the user could paste into the description as-is, in their voice, with concrete
values: hex colours, font families and weights, durations in ms, easing, camera moves and limits, where
humour goes, and what to never do. Fit the user's intent; do not change the style into something else.

Write result.json in your working directory: { "suggestions": [{ "topic": "palette", "text": "..." }] }`;
}
