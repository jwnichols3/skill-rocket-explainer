import { TITLE_PLACEHOLDER } from './stylesheet.ts';

export const CSS_FILE = 'doc.css';

/** Task kind 'doc-stylesheet': one print stylesheet per style, cached by a hash of the style text. */
export function stylesheetPrompt(): string {
  return `You are the print designer for Rocket Explainer. Write the print stylesheet that turns a briefing doc
(Markdown rendered to HTML, then to PDF by headless Chromium) into a document in this style.

Read inputs.json in your working directory. It has:
- style: the style's complete DESIGN.md (YAML tokens, then prose). The "## Doc" section holds the rules for
  briefing docs and wins over everything else; "## Identity" is the shared look. Use the tokens (colors,
  typography, spacing, rounded) for every value you can.
- docRules: the "## Doc" section on its own, for convenience.
- previousError: if present, your previous stylesheet was rejected for this reason. Fix it.
Also read structure.html: a real doc in the exact HTML structure your CSS must style.

The HTML structure (fixed; style these, do not rely on other markup):
- body.doc
- header.doc-cover > h1.doc-title (the document title)
- nav.doc-toc > p.doc-toc-title + ol > li > a (contents)
- main.doc-body > section.doc-section[data-scene] > h2 (section heading, contains an empty a[id]),
  then p, ul/ol, strong/em, a, h3/h4, blockquote (callouts), table/thead/th/td (GFM tables), pre/code.

Write ${CSS_FILE} in your working directory, and nothing else. Requirements:
- @page: size (Letter unless the Doc rules say otherwise) and margins; running headers/footers with
  margin boxes (@top-left, @bottom-right, ...). Page numbers via counter(page) and counter(pages). To show
  the document title in a margin box write content: "${TITLE_PLACEHOLDER}" (it is replaced with the title).
  Use @page :first to treat the first page differently if the style calls for a cover.
- A clear type scale (title, h2, h3, body, small) in pt; line-height; measure; orphans/widows.
- Headings, contents, callouts (blockquote), tables (header row, rules, zebra or not), code, links.
- Colors from the tokens. Backgrounds are printed (printBackground is on); a page colour must be set on
  @page as well as html and body, or the margins stay white. If the style is dark, follow the Doc rules:
  either dark pages or light paper with the palette as accents. Keep body text at a contrast of at least 4.5:1 against its background.
- Pagination: break-after: avoid on headings; break-inside: avoid on callouts, tables and figures.
- Offline only: no @import, no remote url(). Fonts: name the style's font families first, then local
  fallbacks and a generic family (the family may not be installed; the doc must still look right).
- Plain CSS only; no <style> tags, no JavaScript.`;
}

/** Task kind 'doc-figures': turn each section's visuals direction into Markdown callouts and tables. */
export function figuresPrompt(): string {
  return `You are the layout editor for Rocket Explainer's briefing docs. Each section of the doc has body text
(final) and "visuals": a description of the figures and callouts the section should carry. Turn the
visuals into Markdown that sits under the body text.

Read inputs.json in your working directory. It has:
- title: the doc title
- docRules: the style's "## Doc" section (how callouts, tables and figures look; density limits)
- sections: [{ id, title, body, visuals }]; write figures for exactly these sections
- comments: user feedback, if any; apply it

For each section write Markdown using only:
- callouts: blockquotes (lines starting with "> "), optionally starting with a bold label like "**Key point:**"
- tables: GFM pipe tables with a header row (keep them small: at most 5 columns, 8 rows)
- short bullet lists
No headings, no raw HTML, no images, no links to the internet. Use only facts present in the section's body
and visuals; never invent numbers. If the visuals describe something that cannot be a callout, table or
list (a photo, an animation), express its point as a callout or write "" for that section.

Write result.json in your working directory:
{ "sections": [{ "id": "<section id>", "markdown": "<the figures for that section, or empty>" }] }`;
}
