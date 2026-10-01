import { createHash } from 'node:crypto';
import { parseDesign } from '../../style/design.ts';

/** Bump when the HTML structure or the stylesheet prompt changes, so cached stylesheets are regenerated. */
export const STYLESHEET_VERSION = 1;

/** Placeholder the stylesheet may use inside @page margin-box `content` strings; replaced with the doc title. */
export const TITLE_PLACEHOLDER = '__DOC_TITLE__';

export function styleHash(style: string): string {
  return createHash('sha256').update(`doc-stylesheet v${STYLESHEET_VERSION}\n${style}`).digest('hex').slice(0, 16);
}

/** Returns problems with an agent-written stylesheet; empty means usable. */
export function validateCss(css: string): string[] {
  const problems: string[] = [];
  if (!css.trim()) problems.push('doc.css is empty');
  if (css.length > 200_000) problems.push(`doc.css is ${css.length} bytes; keep it under 200 KB`);
  if (/@import/i.test(css)) problems.push('doc.css uses @import; everything must be inline (no network)');
  if (/url\(\s*['"]?\s*(https?:)?\/\//i.test(css)) problems.push('doc.css loads a remote url(); the PDF renders offline');
  if (/<\/style/i.test(css)) problems.push('doc.css contains </style>');
  if (!/@page/.test(css)) problems.push('doc.css has no @page rule (page size, margins, headers/footers)');
  return problems;
}

/** The stylesheet as embedded: title placeholder filled in as a CSS string body. */
export function fillTitle(css: string, title: string): string {
  const s = title.replace(/\s+/g, ' ').trim().replace(/[\\"]/g, (c) => `\\${c}`);
  return css.split(TITLE_PLACEHOLDER).join(s);
}

// ---------- Deterministic fallback, from the style's tokens ----------

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function rgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

function fontStack(family: unknown, generic: 'sans-serif' | 'monospace'): string {
  const name = typeof family === 'string' ? family.replace(/["';{}\\<>]/g, '').trim() : '';
  const tail = generic === 'monospace'
    ? 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
    : 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  return name ? `"${name}", ${tail}` : tail;
}

/**
 * A plain, print-friendly stylesheet from the style's tokens, used when the stylesheet agent
 * fails twice (or there is no agent). Paper is the lighter of background/text, ink the darker;
 * primary/accent carry rules, callouts and table heads, so the style's palette shows on paper.
 */
export function fallbackStylesheet(style: string): string {
  let tokens: Record<string, any> = {};
  try { tokens = parseDesign(style).tokens; } catch { /* defaults below */ }
  const colors: Record<string, string> = Object.fromEntries(Object.entries(tokens.colors ?? {}).filter(([, v]) => typeof v === 'string' && HEX.test(v))) as Record<string, string>;
  const bg = colors.background ?? '#ffffff';
  const fg = colors.text ?? '#111111';
  const [paper, ink] = luminance(bg) >= luminance(fg) ? [bg, fg] : [fg, bg];
  const primary = colors.primary ?? ink;
  const accent = colors.accent ?? colors.secondary ?? primary;
  // Headings in the primary colour only when it reads on paper; otherwise ink with a primary rule.
  const heading = contrast(primary, paper) >= 3 ? primary : ink;
  const type = tokens.typography ?? {};
  const display = fontStack(type.display?.family, 'sans-serif');
  const body = fontStack(type.body?.family, 'sans-serif');
  const mono = fontStack(type.mono?.family, 'monospace');
  const displayWeight = Number(type.display?.weight) || 700;
  const radius = Number(tokens.rounded?.sm) || 4;
  return `/* Fallback briefing-doc stylesheet derived from the style's tokens. */
@page {
  size: Letter;
  margin: 20mm 18mm 22mm 18mm;
  background: ${paper};
  @top-left { content: "${TITLE_PLACEHOLDER}"; font: 500 8pt ${body}; color: color-mix(in srgb, ${ink} 60%, ${paper}); }
  @bottom-right { content: counter(page) " / " counter(pages); font: 500 8pt ${body}; color: color-mix(in srgb, ${ink} 60%, ${paper}); }
}
@page :first { @top-left { content: none; } }
html { background: ${paper}; }
body.doc { margin: 0; background: ${paper}; color: ${ink}; font: 400 10.5pt/1.55 ${body}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.doc-cover { border-top: 6pt solid ${primary}; padding: 14pt 0 10pt; margin-bottom: 14pt; }
.doc-title { font: ${displayWeight} 26pt/1.15 ${display}; letter-spacing: ${typeof type.display?.letterSpacing === 'string' ? type.display.letterSpacing.replace(/[;{}]/g, '') : '-0.01em'}; margin: 0; color: ${ink}; }
.doc-toc { border-left: 3pt solid ${accent}; padding: 4pt 0 4pt 12pt; margin: 0 0 18pt; font-size: 9.5pt; }
.doc-toc-title { margin: 0 0 4pt; font: 600 8pt ${display}; text-transform: uppercase; letter-spacing: 0.08em; color: color-mix(in srgb, ${ink} 65%, ${paper}); }
.doc-toc ol { margin: 0; padding-left: 16pt; }
.doc-toc a { color: ${ink}; text-decoration: none; }
.doc-section { margin: 0 0 14pt; }
h2 { font: ${displayWeight} 15pt/1.25 ${display}; color: ${heading}; margin: 18pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5pt solid ${primary}; break-after: avoid; }
h3, h4 { font: 600 11.5pt/1.3 ${display}; color: ${ink}; margin: 12pt 0 4pt; break-after: avoid; }
p, ul, ol { margin: 0 0 7pt; orphans: 3; widows: 3; }
a { color: ${ink}; text-decoration-color: ${primary}; }
strong { color: ${ink}; }
blockquote { margin: 10pt 0; padding: 8pt 12pt; border-left: 4pt solid ${accent}; background: color-mix(in srgb, ${accent} 14%, ${paper}); border-radius: 0 ${radius}px ${radius}px 0; break-inside: avoid; }
blockquote p:last-child { margin-bottom: 0; }
table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 9.5pt; break-inside: avoid; }
th { text-align: left; background: color-mix(in srgb, ${primary} 22%, ${paper}); color: ${ink}; font-weight: 600; }
th, td { padding: 4pt 7pt; border-bottom: 0.75pt solid color-mix(in srgb, ${ink} 25%, ${paper}); vertical-align: top; }
code, pre { font-family: ${mono}; font-size: 9pt; }
pre { background: color-mix(in srgb, ${ink} 6%, ${paper}); padding: 8pt; border-radius: ${radius}px; white-space: pre-wrap; break-inside: avoid; }
img { max-width: 100%; }
`;
}
