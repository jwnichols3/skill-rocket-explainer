import { h } from '../dom.js';

/**
 * In-page modal (never window.confirm). Resolves with the clicked action's value, or null on cancel.
 * actions: [{ label, value, kind: 'primary'|'danger'|undefined }]
 */
export function dialog({ title, body, actions }) {
  return new Promise((resolve) => {
    const close = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', title),
      h('div.dialog-body', body),
      h('div.row.end', h('button.btn.ghost', { onclick: () => close(null) }, 'Cancel'),
        actions.map((a) => h('button.btn', { class: a.kind ?? '', onclick: () => close(a.value) }, a.label))));
    const overlay = h('div.overlay', { onclick: (e) => { if (e.target === overlay) close(null); } }, box);
    document.addEventListener('keydown', onKey);
    document.body.append(overlay);
    box.querySelector('.btn:last-child')?.focus();
  });
}
