import { h } from '../dom.js';

/**
 * Output viewers by type. A viewer takes a round ({ url, fileUrls, scenes }) and returns
 * { el, seek?(scene), position?() -> { atMs }, supportsTime? }. Each type registers its own file.
 */
export const viewers = {
  video(round) {
    const video = h('video.output', { src: round.url, controls: true, preload: 'auto', playsInline: true });
    return {
      el: h('div.player', video),
      position: () => ({ atMs: Math.round(video.currentTime * 1000) }),
      seek: (s) => { video.currentTime = s.startMs / 1000 + 0.05; video.play().catch(() => {}); },
      supportsTime: true,
    };
  },
};

/** Links to every file of a round (e.g. the .pptx next to the HTML deck). */
export function fileLinks(round) {
  return h('div.row.small', { style: { marginTop: '8px' } }, round.fileUrls.map((u) => h('a.btn.small', { href: u, target: '_blank', rel: 'noopener' }, u.split('/').pop())));
}
