import { h } from '../dom.js';

export async function explainersView(root) {
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Explainers'), h('a.btn.primary', { href: '/new', 'data-link': true }, 'New explainer')),
    h('div.empty', h('p', 'No explainers yet.'), h('p.muted', 'Start one from New explainer.'))));
}
