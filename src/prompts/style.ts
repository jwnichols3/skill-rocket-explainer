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
- currentDesign: the style's current DESIGN.md (a template on the first round)
- comments: the user's feedback on the previous sample, with optional timestamps (ms). Apply every
  comment. Comments are the most important input after round one.
- previousScenes: the scenes of the previous sample, for interpreting timestamped comments
- voice: the narration voice (provider, voice id, controls)

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

const TYPE_SAMPLE: Record<'deck' | 'doc' | 'visual', { unit: string; section: string; exercise: string }> = {
  deck: { unit: 'slides', section: 'Deck', exercise: 'a title slide, a content slide with a diagram or boxes, and a comparison or data slide' },
  doc: { unit: 'sections', section: 'Doc', exercise: 'a title block, a section with a callout, and a section with a small table or figure' },
  visual: { unit: 'panels', section: 'Visual', exercise: 'a headline panel, a diagram panel, and a key-numbers panel' },
};

/** Sample prompt for deck, doc and visual: refine that type's section, plan a 3-unit sample. */
export function styleTypeSamplePrompt(type: 'deck' | 'doc' | 'visual'): string {
  const t = TYPE_SAMPLE[type];
  return `You are the style designer for Rocket Explainer. This style already has a look (its shared identity,
palette, typography, motion and voice). Your job this round: make the style work for ${type === 'doc' ? 'briefing docs' : type === 'deck' ? 'slide decks' : 'one-pager visuals'}, by
writing or refining its "## ${t.section}" section, and plan a short sample that shows it off.

Read inputs.json in your working directory. It has description, currentDesign (the style's DESIGN.md),
comments (the user's feedback on the previous ${type} sample - apply every one), previousScenes, and outputType.

${DESIGN_RULES}

Change the shared sections only if a comment asks for it; the ${type} sample should look like the same
brand as the video. Make the "## ${t.section}" rules concrete (grid, margins, type scale, how diagrams and
callouts look, density limits, what to never do).

## The sample

Plan exactly 3 ${t.unit} exercising ${t.exercise}, on a neutral topic (e.g. "how a message travels across
the internet"). For each: title, narration (the body text), visuals (precise layout and content).

## Output

Write result.json in your working directory:
{ "design": "<the complete DESIGN.md>", "scenes": [{ "id": "s1", "title": "...", "narration": "...", "visuals": "..." }], "summary": "<what you changed and why>" }`;
}
