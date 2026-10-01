import { h, toast, timeAgo, fmtMs, fmtTs } from '../dom.js';
import { api } from '../api.js';
import { workspaceExtensions, OUTPUT_TYPES } from './explainer.js';

/**
 * Viewers per output type: (round) => { el, position?() -> { atMs } | { sceneId }, seek?(scene) }.
 * Other output types register here.
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

const typeLabel = (t) => OUTPUT_TYPES.find((x) => x.id === t)?.label ?? t;

function outputPanel({ e, busy, reload }) {
  const type = e.outputType;
  const state = e.outputs?.[type];
  const approved = !!e.approvedPlan;
  if (!approved && !state) return null;
  const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); await reload(); } catch (err) { toast(err.message, 'error'); } };
  const base = `/api/explainers/${e.id}/outputs/${type}`;

  if (!state) {
    return h('div.panel.output-panel',
      h('div.panel-head', h('h2', typeLabel(type))),
      h('p.muted', 'The plan is approved. Building writes the script, narrates and renders each scene, and assembles the result.'),
      h('button.btn.primary', { disabled: busy, onclick: () => act(() => api(`${base}/build`, { method: 'POST', body: {} })) }, `Build ${typeLabel(type).toLowerCase()}`));
  }

  const round = state.rounds.find((r) => r.n === state.current) ?? state.rounds.at(-1);
  const viewer = (viewers[type] ?? viewers.video)(round);

  // Pending changes since the current round: comments and script edits.
  const edited = state.script.filter((s) => {
    const b = round.scenes.find((x) => x.id === s.id);
    return !b || b.narration !== s.narration || b.visuals !== s.visuals;
  });
  const nComments = round.comments.length;
  const pending = [nComments ? `${nComments} comment${nComments === 1 ? '' : 's'}` : null, edited.length ? `${edited.length} edited scene${edited.length === 1 ? '' : 's'}` : null].filter(Boolean);

  const sceneChips = h('div.scene-strip', round.scenes.map((s) => h('button.scene-chip', {
    title: s.narration, onclick: () => viewer.seek?.(s),
    style: viewer.supportsTime && round.durationMs ? { flexGrow: String(Math.max(1, s.durationMs)) } : {},
  }, h('span.mono', s.id), ' ', s.title, viewer.supportsTime ? h('span.muted', ` ${fmtTs(s.startMs)}`) : null)));

  // Comment composer: pin to the current time (video), a scene, or the whole piece.
  const text = h('textarea', { id: 'out-comment', rows: 2, placeholder: '“More upbeat”, “the diagram is too busy”, “say Kafka, not Kinesis”…' });
  const pin = h('select', { id: 'out-pin' },
    viewer.supportsTime ? h('option', { value: '@time' }, 'Current time') : null,
    h('option', { value: '' }, `Whole ${typeLabel(type).toLowerCase()}`),
    round.scenes.map((s) => h('option', { value: s.id }, `${s.id} · ${s.title}`)));
  const composer = h('form.composer', { onsubmit: (ev) => {
    ev.preventDefault();
    if (!text.value.trim()) return;
    const body = { text: text.value };
    if (pin.value === '@time') Object.assign(body, viewer.position?.() ?? {});
    else if (pin.value) body.sceneId = pin.value;
    act(() => api(`${base}/rounds/${round.n}/comments`, { method: 'POST', body }));
  } },
  h('label', { for: 'out-comment' }, 'Comment'), text,
  h('div.row', h('label', { for: 'out-pin', style: { margin: 0 } }, 'Pin to'), h('div', { style: { width: '240px' } }, pin), h('span', { style: { flex: 1 } }), h('button.btn.small', { type: 'submit' }, 'Add comment')));

  const comments = round.comments.length ? h('div', round.comments.map((c) => {
    const scene = c.sceneId ?? (c.atMs != null ? round.scenes.find((s) => c.atMs >= s.startMs && c.atMs < s.startMs + s.durationMs)?.id : null);
    return h('div.comment',
      c.atMs != null ? h('button.ts', { onclick: () => viewer.seek?.({ startMs: c.atMs }) }, fmtTs(c.atMs)) : h('span.badge', scene ?? 'all'),
      h('span', { style: { flex: 1 } }, c.text),
      c.atMs != null && scene ? h('span.badge', scene) : null,
      h('button.btn.ghost.small', { 'aria-label': 'Remove comment', onclick: () => act(() => api(`${base}/rounds/${round.n}/comments/${c.id}`, { method: 'DELETE' })) }, '✕'));
  })) : null;

  // Script editor.
  const editors = state.script.map((s) => {
    const narration = h('textarea', { id: `narr-${s.id}`, rows: 3, value: s.narration });
    const visuals = h('textarea', { id: `vis-${s.id}`, rows: 2, value: s.visuals });
    return { s, narration, visuals, el: h('div.script-scene',
      h('div.row', h('span.badge.mono', s.id), h('strong', s.title), edited.includes(s) ? h('span.badge.warn', 'edited') : null),
      h('label', { for: `narr-${s.id}` }, `Narration for ${s.id}`), narration,
      h('label', { for: `vis-${s.id}` }, `Visuals for ${s.id}`), visuals) };
  });
  const script = h('details.script', edited.length ? { open: true } : {}, h('summary', 'Narration script'),
    h('div.stack', editors.map((x) => x.el)),
    h('div.row.end', { style: { marginTop: '10px' } }, h('button.btn.small', { onclick: () => act(() => api(`${base}/script`, {
      method: 'PUT', body: { scenes: editors.map((x) => ({ id: x.s.id, narration: x.narration.value, visuals: x.visuals.value })) },
    }), 'Script saved') }, 'Save script')));

  const exportPath = h('input', { id: 'out-export', placeholder: '~/Desktop/ or ~/work/options-call.mp4' });

  return h('div.panel.output-panel',
    h('div.panel-head', h('h2', typeLabel(type)), h('span.muted.small', `Round ${round.n} of ${state.rounds.length} · ${round.durationMs ? fmtMs(round.durationMs) + ' · ' : ''}${round.model} · ${timeAgo(round.createdAt)}`)),
    viewer.el,
    sceneChips,
    round.basedOn ? h('p.small.rendered', `Re-rendered ${round.rendered.join(', ')}`) : null,
    h('div.stack', { style: { marginTop: '12px' } }, comments, composer, script),
    h('div.row.end', { style: { marginTop: '12px' } },
      state.rounds.length > 1 ? h('select', { 'aria-label': 'Round', style: { width: 'auto' }, onchange: (ev) => act(() => api(`/api/explainers/${e.id}/outputs/${type}/current`, { method: 'POST', body: { round: Number(ev.target.value) } })) },
        [...state.rounds].reverse().map((r) => h('option', { value: r.n, selected: r.n === round.n }, `Round ${r.n}`))) : null,
      h('button.btn', { disabled: busy, onclick: () => act(() => api(`${base}/build`, { method: 'POST', body: {} })) }, 'Rebuild from plan'),
      h('button.btn.primary', { disabled: busy || !pending.length, onclick: () => act(() => api(`${base}/rerender`, { method: 'POST', body: {} })) },
        pending.length ? `Re-render: ${pending.join(', ')}` : 'Re-render')),
    h('form.row', { style: { marginTop: '16px', flexWrap: 'nowrap' }, onsubmit: (ev) => {
      ev.preventDefault();
      if (!exportPath.value.trim()) return;
      act(() => api(`${base}/export`, { method: 'POST', body: { path: exportPath.value } }), (r) => `Exported to ${r.files.join(', ')}`);
    } }, h('label', { for: 'out-export', style: { margin: 0, whiteSpace: 'nowrap' } }, 'Export to'), h('div', { style: { flex: 1 } }, exportPath), h('button.btn', { type: 'submit' }, 'Export')));
}

workspaceExtensions.push(outputPanel);
