import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

viewers.visual = (round) => ({
  el: h('div', h('div.frame-box', h('img.output-image', { src: round.url, alt: 'One-pager visual' })), fileLinks(round)),
});
