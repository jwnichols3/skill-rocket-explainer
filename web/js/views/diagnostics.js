import { h, timeAgo, fmtMs } from '../dom.js';
import { api } from '../api.js';
import { registerRoute } from '../router.js';
import { checksList } from './setup.js';

async function diagnosticsView(root) {
  const [d, jobs, logs] = await Promise.all([api('/api/diagnostics'), api('/api/jobs'), api('/api/logs')]);
  const logView = h('pre.job-log-view.doc', { hidden: true });
  root.append(h('section.page',
    h('div.crumbs', h('a', { href: '/settings', 'data-link': true }, 'Settings'), ' / Diagnostics'),
    h('header.page-head', h('h1', 'Diagnostics'), h('div.actions', h('button.btn', { onclick: () => { root.replaceChildren(); diagnosticsView(root); } }, 'Re-check'))),
    h('div.grid-2',
      h('div.stack',
        h('div.panel', h('h2', 'Checks'), h('p.muted.small', 'The same checks as `explainer doctor`, for the providers selected now.'), checksList(d.checks)),
        h('div.panel', h('h2', 'Jobs'),
          jobs.length ? h('table.table.small', h('tbody', jobs.slice(0, 50).map((j) => h('tr.job-row',
            h('td', h('strong', j.kind), h('div.muted', j.target)),
            h('td', h('span.badge', { class: j.status === 'succeeded' ? 'ok' : j.status === 'failed' ? 'danger' : '' }, j.status)),
            h('td.muted', timeAgo(j.createdAt), j.startedAt && j.endedAt ? ` · ${fmtMs(new Date(j.endedAt) - new Date(j.startedAt))}` : ''),
            h('td', h('div.row', { style: { flexWrap: 'nowrap' } },
              h('button.btn.ghost.small', { onclick: async () => {
                logView.hidden = false;
                logView.textContent = await (await fetch(`/api/jobs/${j.id}/log`)).text();
                logView.scrollIntoView({ block: 'nearest' });
              } }, 'View log'),
              h('a.btn.ghost.small', { href: `/api/jobs/${j.id}/log`, download: `${j.id}.log` }, 'Download')))))))
            : h('p.muted', 'No jobs yet.'),
          logView)),
      h('div.stack',
        h('div.panel', h('h2', 'Versions'), h('dl.kv.versions', d.versions.flatMap((v) => [h('dt', v.name), h('dd', v.version ?? h('span.muted', 'not found'), v.detail ? h('span.muted.small', ` · ${v.detail}`) : null)]))),
        h('div.panel', h('h2', 'Data'), h('dl.kv.small', h('dt', 'Data dir'), h('dd.mono', d.dataDir))),
        h('div.panel', h('h2', 'Logs'),
          logs.length ? h('div.stack', logs.map((l) => h('div.row', h('a', { href: `/api/logs/${l.name}`, download: l.name }, l.name), h('span.muted.small', `${Math.ceil(l.size / 1024)} KB · ${timeAgo(l.updatedAt)}`)))) : h('p.muted', 'No logs yet.'))))));
}

registerRoute(/^\/diagnostics$/, diagnosticsView);
