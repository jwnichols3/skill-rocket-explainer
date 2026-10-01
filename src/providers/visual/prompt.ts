/** The page file the agent writes. */
export const PAGE_FILE = 'visual.html';

/**
 * Prompt for the `visual-page` agent task: compose (or revise) the whole one-pager as one
 * self-contained HTML page. The contract here is checked by checkHtml() and the capture step.
 */
export function pagePrompt(width: number, maxHeight: number): string {
  return `You are the layout designer for Rocket Explainer. Your job: one one-pager visual (an infographic
poster) as a single self-contained HTML page, in the style given. It is captured to a PNG in headless Chromium.

Read inputs.json in your working directory. It has:
- title: the one-pager's headline
- panels: [{ id, title, body, visuals }] in reading order. body is the panel's text; visuals says what the
  panel shows (layout, diagram, numbers).
- style: the full DESIGN.md. Its YAML tokens (colors, typography, spacing, rounded) and its "## Visual"
  section are the rules for this page; "## Identity" sets the tone. Follow them exactly. visualRules and
  tokens repeat the parts that matter most.
- mode: "compose" (design the page from scratch) or "revise" (see below).
- dirty: panel ids to (re)design. comments: user feedback, if any. problems: what was wrong with your
  previous attempt (failed-attempt.html), if any; fix every one.

## The page contract (checked; a page that breaks it is sent back)

- Write exactly one file: ${PAGE_FILE}, a complete document starting with <!doctype html>.
- Self-contained: all CSS in <style>, diagrams and icons as inline <svg>. No <script>, no external or
  relative URLs anywhere (src, href, url(), @import, <link>). Only "#fragment" and data: URIs are allowed.
  Fonts: name the style's families with system fallbacks, e.g. font-family: "Inter", system-ui, sans-serif.
  Never load web fonts.
- Canvas: html and body have margin 0; the page is exactly ${width} px wide (nothing may overflow sideways)
  and as tall as its content, at most ${maxHeight} px. If the "## Visual" section states an aspect ratio,
  size the page to it. Paint the background on body so the whole canvas is covered.
- Every panel is one element with id and data-scene both set to the panel id, e.g.
  <section id="s2" data-scene="s2">, containing everything that belongs to that panel. One element per panel,
  no other data-scene attributes. The page headline and footer may sit outside the panels.
- Use each panel's title and body: you may split body into lines, bullets or callouts, but do not drop or
  invent facts. Keep text legible when the PNG is shown at half size: body text 20 px or more.

## Revise mode

previous.html is the current page. Copy it to ${PAGE_FILE} and edit it: redesign only the panels in dirty
to match their new title, body and visuals; keep every other panel's markup exactly as it is. Change the
shared layout only if a revised panel no longer fits.

Write ${PAGE_FILE} in your working directory and nothing else.`;
}
