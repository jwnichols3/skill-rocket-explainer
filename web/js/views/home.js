import { h } from '../dom.js';
import { api } from '../api.js';

const ENTRIES = [
  { href: '/new', title: 'New explainer', blurb: 'Point at sources, pick a style and an output, and build.', icon: 'M12 5v14M5 12h14' },
  { href: '/explainers', title: 'Existing explainers', blurb: 'Reopen past work and keep iterating.', icon: 'M4 6h16M4 12h16M4 18h10' },
  { href: '/styles', title: 'Manage styles', blurb: 'Describe a look, watch a sample, refine it, save it.', icon: 'M12 3l2.6 5.6L20 9.5l-4 4 1 5.5-5-2.8-5 2.8 1-5.5-4-4 5.4-.9z' },
  { href: '/settings', title: 'Settings', blurb: 'Agent surfaces, voices, renderers, diagnostics.', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h2m14 0h2M12 3v2m0 14v2' },
];

export async function homeView(root) {
  const { settings } = await api('/api/settings');
  root.append(h('section.page.home',
    settings.setupComplete ? null : h('div.callout.info', { style: { marginTop: '24px' } }, h('strong', 'First run. '), 'Pick where the app runs and which providers it uses. ', h('a', { href: '/setup', 'data-link': true }, 'Finish setup')),
    h('div.hero',
      h('h1', 'Rocket Explainer'),
      h('p.lede', 'Turn a meeting, a paper or a folder into a narrated video, a deck, a one-pager or a briefing doc, in a style you have tuned until it is right.')),
    h('div.entry-grid', ENTRIES.map((e) =>
      h('a.entry-card', { href: e.href, 'data-link': true },
        h('span.entry-icon', svg(e.icon)),
        h('span.entry-title', e.title),
        h('span.entry-blurb', e.blurb))))));
}

function svg(d) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}
