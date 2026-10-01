import { h } from '../dom.js';

export async function stylesView(root) {
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Styles')),
    h('div.empty', h('p', 'No styles yet.'))));
}
