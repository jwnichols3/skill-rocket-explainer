import { SLIDE_W, SLIDE_H, SHAPES } from './model.ts';

/** The slide files a deck-slide task writes, relative to its working directory. */
export const slideFiles = (file: string) => ({ html: `slides/${file}.html`, json: `slides/${file}.json` });

export function slidePrompt(files: { html: string; json: string }): string {
  return `You are designing one slide of a slide deck for Rocket Explainer, in a fixed visual style. The orchestrator assembles the slides into an HTML deck and an editable PowerPoint file.

## Inputs (all in this working directory)
- inputs.json:
  - slide: id, title, body (the slide's content, in prose; use it, condensed into slide copy), visuals (what the slide shows and how it is laid out).
  - index and total: this slide's position in the deck; outline: every slide's id and title, for flow and consistent numbering.
  - deckTitle, width (${SLIDE_W}), height (${SLIDE_H}), comments (reviewer notes on the previous render, when any: address every one).
  - previousError, when present: what was wrong with your previous attempt. Fix every point.
- DESIGN.md: the style. YAML tokens (colors, typography, spacing, rounded, ...) and prose. Follow its "## Deck" section first, then Identity. Take every colour and font from its tokens.
- previous/ (when present): this slide's files from the previous render. Keep what works and change what the slide, comments or error ask for.
- reference/ (when present): another slide of this deck, already rendered. Match its chrome (title position, margins, footer, page numbers) so the deck is consistent.

## Write exactly two files

1. ${files.html}: a complete, self-contained HTML page showing the slide at exactly ${SLIDE_W}x${SLIDE_H} CSS px.
   - html and body: margin 0, width ${SLIDE_W}px, height ${SLIDE_H}px, overflow hidden. Nothing may be cut off: all content fits inside the slide with the style's margins.
   - Inline CSS only. Static: no <script>. No network: no web fonts, CDN links, remote images or @import; use the token font families followed by system fallbacks (e.g. "Inter", system-ui, sans-serif). Inline SVG is fine for diagrams and icons.
   - Slide copy, not paragraphs: a title, then short bullets, labels or numbers. Respect the style's density limits.

2. ${files.json}: the same slide as a structured model, which becomes native, editable PowerPoint objects. Coordinates and sizes are CSS px on the ${SLIDE_W}x${SLIDE_H} slide, matching where things are in your HTML.
   Colours: a token name from DESIGN.md colors (e.g. "primary") or "#rrggbb". Fonts: a typography token name ("display", "body", "mono") or a family name. Sizes are CSS px.
   {
     "background": "background",
     "elements": [
       { "type": "text", "x": 120, "y": 96, "w": 1680, "h": 140, "text": "Title", "font": "display", "size": 88, "color": "text", "bold": true, "align": "left", "valign": "top" },
       { "type": "bullets", "x": 120, "y": 300, "w": 800, "h": 500, "items": ["First point", "Second point"], "font": "body", "size": 40, "color": "text" },
       { "type": "shape", "shape": "roundRect", "x": 1000, "y": 300, "w": 360, "h": 160, "fill": "surface", "line": "primary", "lineWidth": 4, "radius": 24, "text": "Label", "font": "body", "size": 36, "color": "text" },
       { "type": "line", "x1": 1360, "y1": 380, "x2": 1500, "y2": 380, "color": "accent", "width": 4, "arrow": "end", "dash": false },
       { "type": "table", "x": 120, "y": 300, "w": 1680, "h": 400, "rows": [["Option", "Cost"], ["Queue", "$"]], "colW": [1000, 680], "header": true, "font": "body", "size": 32, "color": "text", "headerColor": "background", "headerFill": "primary", "fill": "surface", "border": "muted" },
       { "type": "snapshot", "x": 1000, "y": 520, "w": 800, "h": 400, "why": "hand-drawn gradient illustration" }
     ],
     "notes": "optional speaker notes"
   }
   - Element types: text, bullets, shape (shape: ${SHAPES.join(', ')}; text optional, centred by default), line (arrow: none, start, end, both), table (colW optional, one px width per column), snapshot. Order is back to front.
   - Every piece of text on the slide must be a text, bullets, shape or table element, so it stays editable. Use boxes, lines and shapes for diagrams wherever you can.
   - Use "snapshot" only for a region the other types cannot express (a complex SVG illustration, a gradient mesh, a chart): that region of your rendered HTML is placed as a picture. Keep snapshot regions free of text that matters, and say why in "why".

Do not write any other file.`;
}
