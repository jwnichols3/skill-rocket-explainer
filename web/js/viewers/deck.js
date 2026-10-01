import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

viewers.deck = (round) => {
  const frame = h('iframe.output-frame', { src: round.url, title: 'Deck', sandbox: 'allow-scripts' });
  return {
    el: h('div', h('div.frame-box', frame), fileLinks(round)),
    seek: (s) => { frame.src = `${round.url}#${s.id}`; },
  };
};
