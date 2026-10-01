import { h } from '../dom.js';
import { viewers, fileLinks } from './registry.js';

/**
 * One-pager visual: the PNG, zoomed to fit or at actual size (one CSS px per canvas px).
 * seek(scene) marks that panel, using the panel boxes the renderer records in visual.json
 * (sample.json for style samples). Without the sidecar (e.g. the fake renderer) seek does nothing.
 */
viewers.visual = (round) => {
  const layoutUrl = round.fileUrls.find((u) => u.endsWith('.json'));
  let layout = null;
  let pending = null;
  let actual = false;

  // Explainer rounds carry url; style sample rounds only sampleUrl and fileUrls (primary first).
  const img = h('img.output-image', { src: round.url ?? round.fileUrls[0], alt: 'One-pager visual' });
  const label = h('span.visual-mark-label');
  const mark = h('div.visual-mark', { hidden: true, onclick: () => { mark.hidden = true; } }, label);
  const canvas = h('div.visual-canvas', img, mark);
  const box = h('div.visual-box', canvas);
  const fit = h('button.btn.small', { type: 'button', 'aria-pressed': 'true', onclick: () => setZoom(false) }, 'Fit');
  const full = h('button.btn.small', { type: 'button', 'aria-pressed': 'false', onclick: () => setZoom(true) }, 'Actual size');

  const cssWidth = () => layout?.width ?? img.naturalWidth;
  const sizeCanvas = () => {
    if (img.naturalWidth) canvas.style.setProperty('--aspect', String(img.naturalWidth / img.naturalHeight));
    canvas.style.width = actual && cssWidth() ? `${cssWidth()}px` : '';
  };
  function setZoom(on) {
    actual = on;
    fit.setAttribute('aria-pressed', String(!on));
    full.setAttribute('aria-pressed', String(on));
    box.classList.toggle('actual', on);
    sizeCanvas();
    if (!mark.hidden) mark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function seek(s) {
    if (!layout) { pending = s; return; }
    const p = layout.panels?.find((x) => x.id === s.id);
    if (!p) return;
    Object.assign(mark.style, {
      left: `${(p.x / layout.width) * 100}%`, top: `${(p.y / layout.height) * 100}%`,
      width: `${(p.width / layout.width) * 100}%`, height: `${(p.height / layout.height) * 100}%`,
    });
    mark.dataset.scene = p.id;
    label.textContent = s.title ? `${p.id} · ${s.title}` : p.id;
    mark.hidden = false;
    mark.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  img.addEventListener('load', sizeCanvas);
  if (layoutUrl) {
    fetch(layoutUrl).then((r) => (r.ok ? r.json() : null)).then((l) => {
      layout = l;
      sizeCanvas();
      if (layout && pending) seek(pending);
    }).catch(() => {});
  }

  return {
    el: h('div.visual-viewer',
      h('div.row.small.visual-tools', h('div.row', { role: 'group', 'aria-label': 'Zoom' }, fit, full)),
      box,
      fileLinks({ ...round, fileUrls: round.fileUrls.filter((u) => !u.endsWith('.json')) })),
    seek,
  };
};
