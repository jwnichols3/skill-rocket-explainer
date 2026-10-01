import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

/** Same rule as the renderer's anchorId: scene ids double as HTML ids and PDF named destinations. */
const anchorId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

/**
 * Briefing doc: the PDF, with a toggle to the Markdown it was rendered from.
 * seek(scene) opens the PDF at the section's named destination, or scrolls the Markdown to its heading.
 */
viewers.doc = (round) => {
  const pdfUrl = round.url ?? round.sampleUrl;
  const mdUrl = round.fileUrls.find((u) => u.endsWith('.md'));
  const frame = (hash = '') => h('iframe.output-frame.doc-frame', { src: pdfUrl + hash, title: 'Briefing doc' });
  const box = h('div.frame-box', frame());
  const md = h('pre.doc-md', { hidden: true, tabIndex: 0, 'aria-label': 'Briefing doc Markdown' });
  let loaded = null;
  let headings = [];

  /** Markdown as text; `## ` lines become targets keyed by their anchor id, else by position. */
  const loadMd = () => loaded ??= fetch(mdUrl).then((r) => r.text()).then((text) => {
    md.replaceChildren(...text.split('\n').map((line) => {
      if (!line.startsWith('## ')) return line + '\n';
      const el = h('span.doc-md-heading', { 'data-anchor': /<a id="([^"]+)"><\/a>/.exec(line)?.[1] ?? '' }, line);
      headings.push(el);
      return h('span', el, '\n');
    }));
  }).catch(() => { md.textContent = 'Could not load the Markdown.'; });

  const tabs = {};
  let mode = 'pdf';
  const show = async (m) => {
    mode = m;
    for (const [k, t] of Object.entries(tabs)) t.setAttribute('aria-selected', String(k === m));
    box.hidden = m !== 'pdf';
    md.hidden = m !== 'md';
    if (m === 'md') await loadMd();
  };
  const tab = (m, label) => (tabs[m] = h('button.type-tab', { type: 'button', role: 'tab', 'aria-selected': String(m === mode), onclick: () => show(m) }, label));
  const bar = h('div.type-bar.doc-tabs', { role: 'tablist', 'aria-label': 'Doc view' }, tab('pdf', 'PDF'), mdUrl ? tab('md', 'Markdown') : null);

  return {
    el: h('div.doc-viewer', bar, box, md, fileLinks(round)),
    async seek(s) {
      if (!s?.id) return;
      const id = anchorId(s.id);
      if (mode === 'pdf') {
        // A new frame: the built-in PDF viewer honours #nameddest on load, not on a hash change.
        box.replaceChildren(frame(`#nameddest=${encodeURIComponent(id)}`));
        return;
      }
      await loadMd();
      const i = (round.scenes ?? []).findIndex((x) => x.id === s.id);
      const target = headings.find((el) => el.dataset.anchor === id) ?? headings[i];
      if (!target) return;
      for (const el of headings) el.classList.toggle('is-target', el === target);
      md.scrollTop = target.offsetTop - md.offsetTop - 8;
    },
  };
};
