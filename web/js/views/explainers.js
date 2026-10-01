import { h, timeAgo } from '../dom.js';
import { api } from '../api.js';

export async function explainersView(root) {
  const [list, styles] = await Promise.all([api('/api/explainers'), api('/api/styles')]);
  const styleName = Object.fromEntries(styles.map((s) => [s.id, s.name ?? 'Untitled style']));
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Explainers'), h('div.actions', h('a.btn.primary', { href: '/new', 'data-link': true }, 'New explainer'))),
    list.length === 0
      ? h('div.empty', h('p', 'No explainers yet.'), h('p.muted', 'Start one from New explainer.'))
      : h('div.panel', { style: { padding: 0 } }, h('table.table.explainer-list',
          h('thead', h('tr', h('th', 'Title'), h('th', 'Style'), h('th', 'Output'), h('th', 'Status'), h('th', 'Updated'))),
          h('tbody', list.map((e) => h('tr',
            h('td', h('a', { href: `/explainers/${e.id}`, 'data-link': true }, e.title || 'Untitled explainer'), h('div.muted.small', e.brief)),
            h('td', e.styleId ? styleName[e.styleId] ?? 'deleted style' : '—'),
            h('td', h('span.badge', e.outputType)),
            h('td', h('span.badge', { class: e.status === 'approved' || e.status === 'built' ? 'ok' : '' }, e.status)),
            h('td.muted.small', timeAgo(e.updatedAt)))))))));
}
