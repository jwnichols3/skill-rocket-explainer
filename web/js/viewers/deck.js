import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

/**
 * Deck viewer: the HTML deck in a sandboxed iframe, prev/next and a slide index. Slides are
 * addressed by the URL hash (#<sceneId>), which the deck follows; a deck that posts
 * { type: 'deck-slide', id } on its own navigation (keyboard, clicks) keeps the index in sync.
 */
viewers.deck = (round) => {
  const url = round.url ?? round.sampleUrl;
  const ids = (round.scenes ?? []).map((s) => s.id);
  let current = 0;
  const frame = h('iframe.output-frame', { src: ids.length ? `${url}#${encodeURIComponent(ids[0])}` : url, title: 'Deck', sandbox: 'allow-scripts' });
  const index = h('span.deck-index.mono', { 'aria-live': 'polite' });
  const prev = h('button.btn.small', { type: 'button', 'aria-label': 'Previous slide', onclick: () => go(current - 1) }, '‹ Prev');
  const next = h('button.btn.small', { type: 'button', 'aria-label': 'Next slide', onclick: () => go(current + 1) }, 'Next ›');

  function show(i) {
    current = Math.max(0, Math.min(ids.length - 1, i));
    const s = round.scenes[current];
    index.textContent = ids.length ? `Slide ${current + 1} / ${ids.length} · ${s.title}` : '';
    prev.disabled = current <= 0;
    next.disabled = current >= ids.length - 1;
  }
  function go(i) {
    if (!ids.length) return;
    show(i);
    frame.src = `${url}#${encodeURIComponent(ids[current])}`;
  }
  function onMessage(ev) {
    if (!frame.isConnected) { removeEventListener('message', onMessage); return; }
    if (ev.source !== frame.contentWindow || ev.data?.type !== 'deck-slide') return;
    const i = ids.indexOf(ev.data.id);
    if (i >= 0) show(i);
  }
  addEventListener('message', onMessage);
  show(0);

  return {
    el: h('div',
      h('div.frame-box', frame),
      ids.length ? h('div.deck-nav', prev, index, next) : null,
      fileLinks(round)),
    seek: (s) => { const i = ids.indexOf(s.id); if (i >= 0) go(i); },
  };
};
