import { parse as parseYaml } from 'yaml';

/**
 * A style's instructions: Google's DESIGN.md (YAML tokens + prose), extended with
 * motion, camera, voice and one section per output type.
 */

export const REQUIRED_SECTIONS = ['Identity', 'Motion', 'Camera', 'Voice', 'Video', 'Deck', 'Doc', 'Visual'] as const;

export interface ParsedDesign {
  tokens: Record<string, any>;
  /** Section title (first word, e.g. 'Identity') -> body. */
  sections: Record<string, string>;
  body: string;
}

export function parseDesign(text: string): ParsedDesign {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('DESIGN.md must start with a YAML token block between --- lines');
  let tokens: Record<string, any>;
  try { tokens = parseYaml(m[1]) ?? {}; } catch (err: any) { throw new Error(`DESIGN.md token block is not valid YAML: ${err.message}`); }
  if (typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('DESIGN.md token block must be a YAML mapping');
  const sections: Record<string, string> = {};
  const parts = m[2].split(/^## +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const key = title.split(/[\s:(-]/)[0];
    sections[key] = (nl < 0 ? '' : part.slice(nl + 1)).trim();
  }
  return { tokens, sections, body: m[2] };
}

/** Returns a list of problems; empty means valid. */
export function validateDesign(text: string): string[] {
  let d: ParsedDesign;
  try { d = parseDesign(text); } catch (err: any) { return [err.message]; }
  const problems: string[] = [];
  if (!d.tokens.colors || typeof d.tokens.colors !== 'object') problems.push('tokens: missing colors');
  if (!d.tokens.typography || typeof d.tokens.typography !== 'object') problems.push('tokens: missing typography');
  for (const s of REQUIRED_SECTIONS) if (!(s in d.sections)) problems.push(`missing section "## ${s}"`);
  return problems;
}

/** Swatches for the UI: [name, css colour] from the colors token. */
export function palette(text: string): [string, string][] {
  try {
    const colors = parseDesign(text).tokens.colors ?? {};
    return Object.entries(colors).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]);
  } catch {
    return [];
  }
}

/** The skeleton every new style starts from. The agent fills and rewrites it. */
export function designTemplate(description: string): string {
  return `---
colors:
  background: "#0b0f14"
  surface: "#141a22"
  primary: "#4fd1c5"
  secondary: "#7f9cf5"
  accent: "#f6e05e"
  text: "#f7fafc"
  muted: "#a0aec0"
typography:
  display: { family: "Inter", weight: 800, letterSpacing: "-0.02em" }
  body: { family: "Inter", weight: 400 }
  mono: { family: "JetBrains Mono", weight: 500 }
spacing: { unit: 8, safeArea: 96 }
rounded: { sm: 6, md: 12, lg: 24 }
motion:
  pace: "medium"
  easing: "cubic-bezier(0.22, 1, 0.36, 1)"
  transitionMs: 600
  enter: "fade-up"
camera:
  moves: ["slow push-in"]
  maxZoom: 1.15
voice:
  delivery: "clear and warm"
---
# Style

> ${description.replace(/\n/g, '\n> ')}

## Identity and tone

Who this style is, what it feels like, and where humour is allowed.

## Motion

How things enter, move and leave. Timing, easing, transitions between scenes.

## Camera

Camera moves (push-ins, pans, parallax), when they happen and how far.

## Voice

Narration delivery: pace, energy, warmth, pauses.

## Video

Rules for narrated video: scene length, title cards, text pop-ups, boxes, diagrams, captions.

## Deck

Rules for slides: layout grid, title treatment, density, how diagrams appear.

## Doc

Rules for the briefing doc: typography scale, headings, callouts, page layout.

## Visual

Rules for the one-pager visual: composition, hierarchy, density.
`;
}
