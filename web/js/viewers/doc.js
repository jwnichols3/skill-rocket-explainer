import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

viewers.doc = (round) => {
  const frame = h('iframe.output-frame.doc-frame', { src: round.url, title: 'Briefing doc' });
  return { el: h('div', h('div.frame-box', frame), fileLinks(round)) };
};
