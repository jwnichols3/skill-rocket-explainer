import { h, toast, timeAgo, fmtTs } from '../dom.js';
import { dialog } from '../components/dialog.js';
import { navigate } from '../router.js';
import { api } from '../api.js';
import { registerRoute } from '../router.js';
import { jobView } from '../components/job.js';
import { attachPathCompletion, pathSuggestions, guessKind, kindLabel } from '../components/sources.js';

export const OUTPUT_TYPES = [
  { id: 'video', label: 'Video', blurb: 'Narrated animation, MP4' },
  { id: 'deck', label: 'Deck', blurb: 'HTML slides + .pptx' },
  { id: 'doc', label: 'Briefing doc', blurb: 'Markdown + styled PDF' },
  { id: 'visual', label: 'Visual', blurb: 'One-pager, HTML + PNG' },
];

const STEPS = ['Sources', 'Report', 'Choices', 'Plan', 'Build'];

function stepIndex(e) {
  if (e.approvedPlan || e.outputs?.[e.outputType]) return 4;
  if (e.plans.some((p) => p.outputType === e.outputType)) return 3;
  if (e.report) return e.styleId ? 3 : 2;
  return 1;
}

/** Sections that later tickets add to the workspace (build, outputs). */
export const workspaceExtensions = [];

async function explainerView(root, { id }) {
  let stopJob = null;
  const page = h('section.page');
  root.append(page);
  const [{ settings, available }, styles] = await Promise.all([api('/api/settings'), api('/api/styles')]);

  async function load() {
    stopJob?.();
    stopJob = null;
    const [e, active] = await Promise.all([api(`/api/explainers/${id}`), api(`/api/jobs?target=explainer:${id}&active=1`)]);
    const last = active[0] ? null : (await api(`/api/jobs?target=explainer:${id}`))[0];
    const busy = !!active[0];
    const ctx = { e, busy, reload: load, settings, styles, surfaces: available.agent };

    const jobBox = h('div');
    const job = active[0] ?? (last && last.status === 'failed' && last.createdAt > e.updatedAt ? last : null);
    if (job) {
      const v = jobView(job.id, { onEnd: (j) => { if (j.status === 'succeeded') load(); } });
      stopJob = v.stop;
      jobBox.append(v.el);
    }

    const at = stepIndex(e);
    page.replaceChildren(
      h('div.crumbs', h('a', { href: '/explainers', 'data-link': true }, 'Explainers'), ' / ', e.title || 'Untitled explainer'),
      h('header.page-head', h('div', h('h1', e.title || 'Untitled explainer'), h('p.muted', { style: { margin: 0 } }, e.brief)),
        h('div.actions', h('button.btn.danger', { disabled: busy, onclick: () => remove(e) }, 'Delete explainer'))),
      h('div.steps', STEPS.map((s, i) => h('span.step', { 'data-n': i + 1, class: i < at ? 'done' : i === at ? 'current' : '' }, s))),
      jobBox,
      h('div.grid-2',
        h('div.stack', ...workspaceExtensions.map((fn) => fn(ctx)), planPanel(ctx), reportPanel(ctx)),
        h('div.stack', sourcesPanel(ctx), choicesPanel(ctx), historyPanel(ctx), usagePanel(ctx))));
  }

  async function remove(e) {
    const ok = await dialog({
      title: `Delete “${e.title || 'Untitled explainer'}”?`,
      body: h('p', 'This removes its sources list, report, plans, rounds and rendered outputs from the app. Files you exported elsewhere stay.'),
      actions: [{ label: 'Delete', value: true, kind: 'danger' }],
    });
    if (!ok) return;
    try { await api(`/api/explainers/${id}`, { method: 'DELETE' }); toast('Explainer deleted'); navigate('/explainers'); }
    catch (err) { toast(err.message, 'error'); }
  }

  /** Tokens and estimated cost, one row per job (report, plan, builds, re-renders). */
  function usagePanel({ e }) {
    const { entries, totals } = e.usage ?? { entries: [], totals: null };
    if (!entries.length) return null;
    const n = (x) => x.toLocaleString('en-US');
    const usd = (x) => (x > 0 && x < 0.01 ? '< $0.01' : `$${x.toFixed(2)}`);
    const KIND = { 'source-report': 'Source report', plan: 'Plan' };
    const label = (k) => KIND[k] ?? k.replace(/^(build|rerender)-(\w+)$/, (_, a, t) => `${a === 'build' ? 'Build' : 'Re-render'} ${t}`);
    const rows = entries.map((u) => h('tr',
      h('td', label(u.kind), u.status !== 'succeeded' ? h('span.muted.small', ` (${u.status})`) : null, h('div.small.muted', timeAgo(u.at))),
      h('td.small', u.models.join(', ') || '-'),
      h('td.small', u.agentRuns ? `${n(u.inputTokens)} in / ${n(u.outputTokens)} out` : '-'),
      h('td.small', u.ttsChars ? `${n(u.ttsChars)} chars` : '-'),
      h('td.small', u.ttsCostUsd === null && u.ttsChars ? `${usd(u.costUsd)} + narration` : usd(u.costUsd))));
    return h('div.panel', h('details.usage',
      h('summary', `Usage · ≈ ${usd(totals.costUsd)} · ${n(totals.inputTokens + totals.outputTokens)} tokens`),
      h('table.table', h('thead', h('tr', h('th', 'Job'), h('th', 'Model'), h('th', 'Tokens'), h('th', 'Narration'), h('th', 'Est. cost'))), h('tbody', rows)),
      h('p.hint', 'Costs are estimates. Agent cost is Claude Code\'s figure at API list prices, so on a Claude subscription it is not what you are billed. Narration uses Amazon Polly list prices; Kokoro is free; ElevenLabs depends on your plan.')));
  }

  /** Everything that happened, oldest first: sources, report, plan versions, output rounds, comments. */
  function historyPanel({ e }) {
    const items = [];
    const commentList = (cs) => cs.length ? h('ul.small', cs.map((c) => h('li', c.atMs != null ? `${fmtTs(c.atMs)} ` : c.sceneId ? `[${c.sceneId}] ` : '', c.text))) : null;
    items.push(h('div.history-item', h('strong', 'Sources'), h('ul.small', e.sources.map((s) => h('li', { style: { opacity: s.enabled ? 1 : 0.5 } }, `${s.kind}: ${s.value}`)))));
    if (e.corrections.length) items.push(h('div.history-item', h('strong', 'Corrections'), commentList(e.corrections)));
    if (e.report) items.push(h('div.history-item', h('strong', 'Source report'), h('span.muted.small', ` ${timeAgo(e.report.createdAt)}`)));
    for (const p of e.plans) {
      const approved = e.approvedPlans?.[p.outputType] === p.n;
      items.push(h('div.history-item', h('strong', `Plan v${p.n} · ${p.outputType}${approved ? ' · approved' : ''}`), h('span.muted.small', ` ${p.model} · ${timeAgo(p.createdAt)}`), h('div.small', p.plan.title), commentList(p.comments)));
    }
    for (const [type, state] of Object.entries(e.outputs ?? {})) {
      for (const r of state.rounds) {
        items.push(h('div.history-item', h('strong', `${type[0].toUpperCase()}${type.slice(1)} round ${r.n}`), h('span.muted.small', ` ${r.model} · ${timeAgo(r.createdAt)}${r.basedOn ? ` · re-rendered ${r.rendered.join(', ')}` : ''}`),
          h('div', h('a.small', { href: r.url, target: '_blank' }, 'Open file')), commentList(r.comments)));
      }
    }
    return h('div.panel', h('details.history', h('summary', 'History'), h('div.stack', items)));
  }

  async function act(fn, ok) {
    try { await fn(); if (ok) toast(ok); await load(); } catch (err) { toast(err.message, 'error'); }
  }

  function sourcesPanel({ e, busy }) {
    const add = h('input', { id: 'add-source', placeholder: 'Path, link, connector or note' });
    attachPathCompletion(add);
    const correction = h('input', { id: 'correction', placeholder: 'e.g. “Option B is Kafka, not Kinesis”' });
    // Read fresh state before each edit so quick successive edits don't overwrite each other.
    const save = async (fn) => {
      const fresh = await api(`/api/explainers/${id}`);
      return api(`/api/explainers/${id}`, { method: 'PUT', body: { sources: fn(fresh.sources) } });
    };
    return h('div.panel',
      h('div.panel-head', h('h2', 'Sources'), h('button.btn.small', { disabled: busy || !e.sources.some((s) => s.enabled), onclick: () => act(() => api(`/api/explainers/${id}/report`, { method: 'POST', body: {} })) }, e.report ? 'Re-run report' : 'Gather sources')),
      h('div', e.sources.map((s) => h('div.source-row.row', { style: { padding: '6px 0', borderBottom: '1px solid var(--border)', flexWrap: 'nowrap' } },
        h('input', { type: 'checkbox', checked: s.enabled, 'aria-label': `Use ${s.value}`, disabled: busy,
          onchange: (ev) => act(() => save((all) => all.map((x) => x.id === s.id ? { ...x, enabled: ev.target.checked } : x))) }),
        h('span.badge', kindLabel(s.kind)),
        h('span.mono', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: s.enabled ? 1 : 0.5 }, title: s.value }, s.value),
        h('button.btn.ghost.small', { 'aria-label': `Remove ${s.value}`, disabled: busy, onclick: () => act(() => save((all) => all.filter((x) => x.id !== s.id))) }, '✕')))),
      h('form.row', { style: { marginTop: '10px', flexWrap: 'nowrap' }, onsubmit: (ev) => {
        ev.preventDefault();
        if (!add.value.trim()) return;
        const value = add.value;
        act(() => save((all) => [...all, { value, kind: guessKind(value) ?? 'connector' }]));
      } }, h('label.sr', { for: 'add-source' }, 'Add a source'), h('div', { style: { flex: 1 } }, add), h('button.btn.small', { type: 'submit' }, 'Add')),
      pathSuggestions(),
      h('h3', { style: { marginTop: '18px' } }, 'Corrections'),
      e.corrections.length ? h('div', e.corrections.map((c) => h('div.comment', h('span', { style: { flex: 1 } }, c.text),
        h('button.btn.ghost.small', { 'aria-label': 'Remove correction', onclick: () => act(() => api(`/api/explainers/${id}/corrections/${c.id}`, { method: 'DELETE' })) }, '✕'))))
        : h('p.muted.small', 'Tell the agent what it got wrong; corrections override the sources.'),
      h('form.row', { style: { flexWrap: 'nowrap' }, onsubmit: (ev) => {
        ev.preventDefault();
        if (!correction.value.trim()) return;
        act(() => api(`/api/explainers/${id}/corrections`, { method: 'POST', body: { text: correction.value } }));
      } }, h('label.sr', { for: 'correction' }, 'Correction'), h('div', { style: { flex: 1 } }, correction), h('button.btn.small', { type: 'submit' }, 'Add correction')));
  }

  function reportPanel({ e }) {
    if (!e.report) return h('div.panel.report', h('h2', 'Source report'), h('p.muted', 'Gathering sources produces a report of what was found and what wasn’t.'));
    const r = e.report;
    const byId = Object.fromEntries(e.sources.map((s) => [s.id, s]));
    const found = r.sources.filter((s) => s.found).length;
    return h('div.panel.report',
      h('div.panel-head', h('h2', 'Source report'), h('span.muted.small', `${found} of ${r.sources.length} found · ${timeAgo(r.createdAt)}`)),
      h('p.overall', r.overall),
      h('div', r.sources.map((f) => h('div.finding', { style: { padding: '10px 0', borderTop: '1px solid var(--border)' } },
        h('div.row', h('span.badge', { class: f.found ? 'ok' : 'danger' }, f.found ? 'found' : 'not found'),
          h('span.mono.small', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, byId[f.sourceId]?.value ?? f.sourceId)),
        f.summary ? h('p', { style: { margin: '6px 0 0' } }, f.summary) : null,
        f.notes ? h('p.muted.small', { style: { margin: '4px 0 0' } }, f.notes) : null,
        f.extract ? h('details', { style: { marginTop: '6px' } }, h('summary.small', 'What I extracted'), h('div.md', f.extract)) : null))),
      r.gaps.length ? h('div.callout.warn', { style: { marginTop: '12px' } }, h('strong', 'Gaps: '), r.gaps.join(' · ')) : null);
  }

  function choicesPanel({ e, busy, settings, styles, surfaces }) {
    const put = (body) => act(() => api(`/api/explainers/${id}`, { method: 'PUT', body }));
    const styleSel = h('select', { id: 'ex-style', disabled: busy, onchange: () => put({ styleId: styleSel.value || null }) },
      h('option', { value: '' }, styles.length ? 'Pick a style…' : 'No styles yet'),
      styles.map((s) => h('option', { value: s.id, selected: s.id === e.styleId }, s.name ?? 'Untitled style')));
    const model = h('select', { id: 'ex-model', disabled: busy, onchange: () => put({ model: model.value }) }, settings.models.map((m) => h('option', { value: m.id, selected: m.id === e.model }, m.label)));
    const effort = h('select', { id: 'ex-effort', disabled: busy, onchange: () => put({ effort: effort.value }) }, settings.efforts.map((x) => h('option', { value: x, selected: x === e.effort }, x)));
    const surface = h('select', { id: 'ex-surface', disabled: busy, onchange: () => put({ surface: surface.value }) },
      surfaces.map((s) => h('option', { value: s.id, selected: s.id === (e.surface || settings.providers.agent) }, s.label)));
    return h('div.panel',
      h('h2', 'Choices'),
      h('div.field', h('label', { for: 'ex-style' }, 'Style'), styleSel, h('div.hint', h('a', { href: '/styles/new', 'data-link': true }, 'Define a new style'))),
      h('div.field', h('label', 'Output'), h('div.type-grid', { role: 'radiogroup', 'aria-label': 'Output type' }, OUTPUT_TYPES.map((t) => h('label.type-card',
        h('input', { type: 'radio', name: 'output-type', value: t.id, checked: e.outputType === t.id, disabled: busy, 'aria-label': `${t.label}: ${t.blurb}`, onchange: () => put({ outputType: t.id }) }),
        h('span', h('strong', t.label), h('span.muted.small', t.blurb)))))),
      h('div.row', { style: { alignItems: 'flex-start' } },
        h('div.field', { style: { flex: 2 } }, h('label', { for: 'ex-model' }, 'Model'), model),
        h('div.field', { style: { flex: 1 } }, h('label', { for: 'ex-effort' }, 'Effort'), effort)),
      h('div.field', h('label', { for: 'ex-surface' }, 'Runs on'), surface, h('div.hint', 'Where the agent runs for this explainer. Keep sensitive sources on a narrower surface.')));
  }

  function planPanel({ e, busy }) {
    const latest = e.plans.filter((x) => x.outputType === e.outputType).at(-1);
    const canPlan = e.report && e.styleId && !busy;
    if (!latest) {
      return h('div.panel.plan', h('div.panel-head', h('h2', 'Plan')),
        h('p.muted', !e.report ? 'After the source report.' : !e.styleId ? 'Pick a style, then propose a plan.' : 'Here’s what I’m thinking of building: propose a plan to react to before anything renders.'),
        h('button.btn.primary', { disabled: !canPlan, onclick: () => act(() => api(`/api/explainers/${id}/plan`, { method: 'POST', body: {} })) }, 'Propose a plan'));
    }
    const p = latest.plan;
    const approved = e.approvedPlan === latest.n;
    const comment = h('textarea', { id: 'plan-comment', rows: 2, placeholder: '“Lead with the cost comparison”, “cut scene 4”, “more humour”…' });
    const n = latest.comments.length;
    return h('div.panel.plan',
      h('div.panel-head', h('h2', 'Plan'), h('span.muted.small', `v${latest.n} · ${p.length} · ${latest.model}`), approved ? h('span.badge.ok', 'approved') : null),
      h('h3', p.title), h('p', p.summary),
      h('ol.plan-outline', p.outline.map((o) => h('li', o))),
      h('div', p.scenes.map((s) => h('div.plan-scene', { style: { padding: '10px 0', borderTop: '1px solid var(--border)' } },
        h('div.row', h('span.badge.mono', s.id), h('strong', s.title), s.purpose ? h('span.muted.small', s.purpose) : null),
        s.narration ? h('p', { style: { margin: '6px 0 2px' } }, `“${s.narration}”`) : null,
        h('p.muted.small', { style: { margin: 0 } }, s.visuals)))),
      h('div', { style: { marginTop: '10px' } }, h('strong.small', 'Key visuals'), h('ul.small', p.keyVisuals.map((k) => h('li', k)))),
      latest.comments.length ? h('div', latest.comments.map((c) => h('div.comment', h('span', { style: { flex: 1 } }, c.text),
        h('button.btn.ghost.small', { 'aria-label': 'Remove comment', onclick: () => act(() => api(`/api/explainers/${id}/plans/${latest.n}/comments/${c.id}`, { method: 'DELETE' })) }, '✕')))) : null,
      h('form.composer', { onsubmit: (ev) => {
        ev.preventDefault();
        if (!comment.value.trim()) return;
        act(() => api(`/api/explainers/${id}/plans/${latest.n}/comments`, { method: 'POST', body: { text: comment.value } }));
      } }, h('label', { for: 'plan-comment' }, 'Comment on the plan'), comment, h('div.row.end', h('button.btn.small', { type: 'submit' }, 'Add comment'))),
      h('div.row.end', { style: { marginTop: '12px' } },
        h('button.btn', { disabled: !canPlan, onclick: () => act(() => api(`/api/explainers/${id}/plan`, { method: 'POST', body: {} })) }, n ? `Revise with ${n} comment${n === 1 ? '' : 's'}` : 'Regenerate'),
        approved ? null : h('button.btn.primary', { disabled: busy, onclick: () => act(() => api(`/api/explainers/${id}/approve`, { method: 'POST', body: {} }), 'Plan approved') }, 'Approve plan')));
  }

  await load();
  return () => stopJob?.();
}

registerRoute(/^\/explainers\/(?<id>ex_\w+)$/, explainerView);
