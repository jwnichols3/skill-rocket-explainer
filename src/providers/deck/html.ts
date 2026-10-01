import { SLIDE_W, SLIDE_H } from './model.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Problems with a slide's HTML; empty means usable. */
export function checkSlideHtml(html: string): string[] {
  const problems: string[] = [];
  if (!/<(html|body|div|section|main|svg|h1|h2|p)\b/i.test(html)) problems.push('the slide HTML has no content elements');
  if (/<script\b/i.test(html)) problems.push('the slide must be static HTML and CSS: remove every <script>');
  const remote = /<(?:link|img|iframe|source|video|audio|object|embed)\b[^>]*\b(?:src|href|data)\s*=\s*["']?\s*(?:https?:)?\/\//i.exec(html)
    ?? /url\(\s*["']?\s*(?:https?:)?\/\//i.exec(html) ?? /@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\//i.exec(html);
  if (remote) problems.push(`the slide loads a remote resource (${remote[0].slice(0, 80)}): no network, inline everything and use system font stacks`);
  return problems;
}

export interface DeckSlide { id: string; title: string; html: string }

/**
 * One self-contained deck.html: each slide is an isolated srcdoc iframe (so slides' CSS can't
 * collide) inside <section id="<sceneId>">, scaled to fit the window, one shown at a time.
 * Navigation: arrows/space/PageUp/PageDown/Home/End, click right/left half, and the URL hash
 * (#<sceneId>) both ways. Posts { type: 'deck-slide', id, index, total } to the parent on each change.
 * Printing gives one slide per page.
 */
export function assembleDeck(title: string, background: string, slides: DeckSlide[]): string {
  const sections = slides.map((s, i) => `<section class="slide" id="${esc(s.id)}" data-scene="${esc(s.id)}" aria-label="Slide ${i + 1}: ${esc(s.title)}">
<iframe title="${esc(s.title)}" tabindex="-1" srcdoc="${esc(s.html)}"></iframe>
</section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #${background}; }
  .slide { position: absolute; left: 0; top: 0; width: ${SLIDE_W}px; height: ${SLIDE_H}px; transform-origin: 0 0; display: none; cursor: pointer; }
  .slide.active { display: block; }
  .slide iframe { display: block; width: ${SLIDE_W}px; height: ${SLIDE_H}px; border: 0; pointer-events: none; }
  @media print {
    @page { size: ${SLIDE_W}px ${SLIDE_H}px; margin: 0; }
    html, body { height: auto; overflow: visible; }
    .slide { display: block; position: relative; transform: none !important; break-after: page; }
  }
</style>
</head>
<body>
${sections}
<script>
(() => {
  const slides = [...document.querySelectorAll('.slide')];
  let current = 0;
  function fit() {
    const s = Math.min(innerWidth / ${SLIDE_W}, innerHeight / ${SLIDE_H});
    const x = (innerWidth - ${SLIDE_W} * s) / 2, y = (innerHeight - ${SLIDE_H} * s) / 2;
    for (const el of slides) el.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  }
  function show(n) {
    if (!slides.length) return;
    current = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((el, i) => el.classList.toggle('active', i === current));
    const id = slides[current].id;
    if (decodeURIComponent(location.hash.slice(1)) !== id) { try { history.replaceState(null, '', '#' + encodeURIComponent(id)); } catch {} }
    try { parent.postMessage({ type: 'deck-slide', id, index: current, total: slides.length }, '*'); } catch {}
  }
  function fromHash() {
    const i = slides.findIndex((el) => el.id === decodeURIComponent(location.hash.slice(1)));
    show(i < 0 ? current : i);
  }
  addEventListener('resize', fit);
  addEventListener('hashchange', fromHash);
  addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ' ': 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
    if (step) { e.preventDefault(); show(current + step); }
    else if (e.key === 'Home') show(0);
    else if (e.key === 'End') show(slides.length - 1);
  });
  addEventListener('click', (e) => show(current + (e.clientX < innerWidth / 3 ? -1 : 1)));
  fit();
  fromHash();
})();
</script>
</body>
</html>
`;
}
