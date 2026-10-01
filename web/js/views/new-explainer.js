import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { navigate } from '../router.js';
import { KINDS, guessKind, attachPathCompletion, pathSuggestions } from '../components/sources.js';

export async function newExplainerView(root) {
  // Prefill from the query string (the /explainer skill passes what it was given).
  const q = new URLSearchParams(location.search);
  const title = h('input', { id: 'ex-title', placeholder: 'Optional; we can suggest one' });
  const brief = h('textarea', { id: 'ex-brief', rows: 4, value: q.get('brief') ?? '', placeholder: 'e.g. “the options discussed on this call, for an exec audience”' });
  const list = h('div.stack');
  const rows = [];

  function addRow(value = '') {
    const n = rows.length + 1;
    const kind = h('select', { 'aria-label': `Source ${n} kind` }, KINDS.map((k) => h('option', { value: k.id }, k.label)));
    const input = h('input', { id: `source-${n}`, value, placeholder: 'A path, a link, “the email thread about…”, or a note' });
    attachPathCompletion(input);
    input.addEventListener('change', () => { const k = guessKind(input.value); if (k) kind.value = k; });
    const row = h('div.row.source-input',
      h('label.sr', { for: `source-${n}` }, `Source ${n}`),
      h('div', { style: { width: '160px' } }, kind),
      h('div', { style: { flex: 1 } }, input),
      h('button.btn.ghost.small', { type: 'button', 'aria-label': `Remove source ${n}`, onclick: () => { row.remove(); rows.splice(rows.indexOf(entry), 1); } }, '✕'));
    const entry = { kind, input };
    rows.push(entry);
    list.append(row);
    return input;
  }
  const prefill = q.getAll('source');
  if (prefill.length) for (const s of prefill) addRow(s); else addRow();

  const go = h('button.btn.primary', { type: 'submit' }, 'Gather sources');
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const sources = rows.map((r) => ({ kind: guessKind(r.input.value) ?? r.kind.value, value: r.input.value })).filter((s) => s.value.trim());
      if (!brief.value.trim() && !sources.length) { toast('Say what to explain, or add a source', 'error'); return; }
      go.disabled = true;
      try {
        // Style and type can arrive from the skill (?style=name&type=deck); otherwise they're chosen after the report.
        const styleWanted = (q.get('style') ?? '').toLowerCase();
        const styleId = styleWanted ? (await api('/api/styles')).find((s) => s.id === q.get('style') || (s.name ?? '').toLowerCase().includes(styleWanted))?.id ?? null : null;
        const outputType = q.get('type') ?? undefined;
        const ex = await api('/api/explainers', { method: 'POST', body: { title: title.value, brief: brief.value, sources, styleId, outputType } });
        await api(`/api/explainers/${ex.id}/report`, { method: 'POST', body: {} });
        navigate(`/explainers/${ex.id}`);
      } catch (err) { toast(err.message, 'error'); go.disabled = false; }
    },
  },
  h('div.panel',
    h('div.field', h('label', { for: 'ex-brief' }, 'What should it explain?'), brief,
      h('div.hint', 'The angle matters: who it is for, what they should walk away knowing.')),
    h('div.field', h('label', { for: 'ex-title' }, 'Title'), title)),
  h('div.panel',
    h('div.panel-head', h('h2', 'Sources'), h('span.muted.small', 'Files and folders autocomplete. Links are fetched. Connectors reach whatever the agent’s tools can.')),
    list, pathSuggestions(),
    h('div.row', { style: { marginTop: '12px' } }, h('button.btn.small', { type: 'button', onclick: () => addRow().focus() }, 'Add source'))),
  h('div.row.end', go));

  root.append(h('section.page',
    h('div.crumbs', h('a', { href: '/explainers', 'data-link': true }, 'Explainers'), ' / New'),
    h('header.page-head', h('h1', 'New explainer')),
    h('div', { style: { maxWidth: '820px' } }, form)));
}
