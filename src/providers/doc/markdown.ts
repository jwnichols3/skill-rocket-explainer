import { Marked, type Token, type Tokens } from 'marked';

/**
 * The briefing doc's Markdown and HTML. The Markdown is assembled deterministically from the
 * script: `# title`, then one `## ` section per scene (body text, then its figures/callouts).
 * Each section heading carries an inline `<a id="<sceneId>"></a>` anchor: valid CommonMark,
 * invisible on GitHub, and the stable target for the viewer and the PDF's named destinations.
 */

export interface DocSection { id: string; title: string; body: string; figures?: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Scene ids double as HTML ids and PDF named destinations; keep them simple. */
export function anchorId(sceneId: string): string {
  return sceneId.replace(/[^A-Za-z0-9_-]/g, '-');
}

const ANCHOR_TAG = /^<a id="[A-Za-z0-9_-]+">$|^<\/a>$/;

/** Raw HTML in body text is shown as text; only our own heading anchors pass through. */
const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag) { return ANCHOR_TAG.test(text.trim()) ? text : esc(text); },
  },
});

/** Top-level `#`/`##` headings inside body text would break one-section-per-scene; demote them to `###`. */
export function demoteHeadings(text: string): string {
  const tokens: Token[] = md.lexer(text.replace(/\r\n/g, '\n'));
  return tokens.map((t) => (t.type === 'heading' && t.depth < 3 ? `### ${(t as Tokens.Heading).text}${/\n*$/.exec(t.raw)![0]}` : t.raw)).join('').trim();
}

/** One-line inline text (titles): no newlines, no leading `#`. */
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function sectionMarkdown(s: DocSection): string {
  const parts = [`## <a id="${anchorId(s.id)}"></a>${oneLine(s.title)}`, demoteHeadings(s.body)];
  if (s.figures?.trim()) parts.push(demoteHeadings(s.figures));
  return parts.filter(Boolean).join('\n\n') + '\n';
}

export function docMarkdown(title: string, sections: DocSection[]): string {
  return [`# ${oneLine(title)}\n`, ...sections.map(sectionMarkdown)].join('\n');
}

/**
 * Self-contained HTML for print. Structure (the stylesheet contract):
 * body.doc > header.doc-cover > h1.doc-title; nav.doc-toc > p.doc-toc-title + ol > li > a[href=#id];
 * main.doc-body > section.doc-section[data-scene] > h2 (with a#id) + p, ul/ol, blockquote (callouts),
 * table (GFM), h3/h4, pre/code. The table of contents also makes Chromium emit a named PDF
 * destination per section, so the viewer can open doc.pdf#nameddest=<id>.
 */
export function docHtml(title: string, sections: DocSection[], css: string): string {
  const toc = sections.map((s) => `<li><a href="#${anchorId(s.id)}">${esc(oneLine(s.title))}</a></li>`).join('');
  const body = sections.map((s) => `<section class="doc-section" data-scene="${esc(s.id)}">\n${md.parse(sectionMarkdown(s)) as string}</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(oneLine(title))}</title>
<style>
${css}
</style>
</head>
<body class="doc">
<header class="doc-cover"><h1 class="doc-title">${esc(oneLine(title))}</h1></header>
<nav class="doc-toc" aria-label="Contents"><p class="doc-toc-title">Contents</p><ol>${toc}</ol></nav>
<main class="doc-body">
${body}
</main>
</body>
</html>
`;
}
