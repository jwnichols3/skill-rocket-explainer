import { h } from '../dom.js';

export async function newExplainerView(root) {
  root.append(h('section.page',
    h('header.page-head', h('h1', 'New explainer')),
    h('div.empty', h('p', 'Coming soon.'))));
}
