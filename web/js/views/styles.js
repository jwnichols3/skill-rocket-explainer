import { h, toast, timeAgo, fmtMs, fmtTs } from '../dom.js';
import { dialog } from '../components/dialog.js';
import { viewers } from '../viewers/registry.js';
import '../viewers/deck.js';
import '../viewers/doc.js';
import '../viewers/visual.js';

const SAMPLE_TYPES = [{ id: 'video', label: 'Video' }, { id: 'deck', label: 'Deck' }, { id: 'doc', label: 'Doc' }, { id: 'visual', label: 'Visual' }];
import { api } from '../api.js';
import { navigate, registerRoute } from '../router.js';
import { jobView } from '../components/job.js';
import { voicePicker, modelPicker } from '../components/pickers.js';
import { pendingReferences, referencesPanel, suggestionBox } from '../components/references.js';

export const styleTitle = (s) => s.name ?? 'Untitled style';

function swatches(palette) {
  return h('div.swatches', palette.slice(0, 7).map(([name, c]) => h('span.swatch', { title: `${name} ${c}`, style: { background: c } })));
}

async function stylesView(root) {
  const styles = await api('/api/styles');
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Styles'), h('div.actions', h('a.btn.primary', { href: '/styles/new', 'data-link': true }, 'New style'))),
    styles.length === 0
      ? h('div.empty', h('p', 'No styles yet.'), h('p.muted', 'A style is a look you tune once and reuse for every explainer.'))
      : h('div.card-grid', styles.map((s) => h('a.card', { href: `/styles/${s.id}`, 'data-link': true },
          h('div.card-media', s.sampleUrl ? h('video', { src: s.sampleUrl + '#t=1.5', muted: true, preload: 'metadata' }) : h('span', 'No sample yet')),
          h('div.card-body',
            h('div.row', h('span.card-title', styleTitle(s)), s.savedAt ? null : h('span.badge.warn', 'draft')),
            h('div.row', swatches(s.palette), h('span.muted.small', `${s.rounds} round${s.rounds === 1 ? '' : 's'} · ${timeAgo(s.updatedAt)}`))))))));
}

async function newStyleView(root) {
  const name = h('input', { id: 'style-name', placeholder: 'e.g. Hitchhiker’s Guide' });
  const later = h('input', { type: 'checkbox', id: 'style-later', onchange: () => { name.disabled = later.checked; if (later.checked) name.value = ''; } });
  const description = h('textarea', { id: 'style-desc', rows: 6, placeholder: 'Describe the look, or the thing it should look like. Smooth transitions? Camera moves? Palette, contrast, energy, humour?' });
  const voice = await voicePicker({}, { preview: true });
  const model = await modelPicker();
  const go = h('button.btn.primary', { type: 'submit' }, 'Render sample');
  const refs = pendingReferences({ onChange: () => { go.textContent = refs.hasVideo() ? 'Analyze reference video' : 'Render sample'; } });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!description.value.trim() && !refs.hasVideo()) { toast('Describe the style first', 'error'); description.focus(); return; }
      go.disabled = true;
      try {
        const desc = description.value.trim() || 'Match the look and feel of the reference video.';
        const style = await api('/api/styles', { method: 'POST', body: { name: later.checked ? null : name.value || null, description: desc, voice: voice.value(), ...model.value() } });
        // With a reference video, its instructions come first; the user reviews them, then renders the sample.
        const { video } = await refs.attach(style.id);
        if (video) await api(`/api/styles/${style.id}/references/${video.id}/analyze`, { method: 'POST', body: {} });
        else await api(`/api/styles/${style.id}/sample`, { method: 'POST', body: {} });
        navigate(`/styles/${style.id}`);
      } catch (err) {
        toast(err.message, 'error');
        go.disabled = false;
      }
    },
  },
  h('div.grid-2',
    h('div',
      h('div.panel',
        h('h2', 'Look and feel'),
        h('div.field', h('label', { for: 'style-name' }, 'Name'), name,
          h('label.row', { for: 'style-later', style: { marginTop: '8px', fontWeight: 400 } }, later, 'Decide later (we’ll suggest names when you save)')),
        h('div.field', h('label', { for: 'style-desc' }, 'Describe the style'), description,
          h('div.hint', 'Concrete beats vague: “titles slam in, neon blue/green on near-black, slow camera push-ins, a dry joke per scene”.'),
          suggestionBox(description, () => model.value()))),
      refs.el),
    h('div',
      h('div.panel', h('h2', 'Voice'), voice.el),
      h('div.panel', h('h2', 'Model'), model.el,
        h('p.muted.small', 'The sample is ~10 seconds and exercises an opening, a transition, text pop-ups, boxes, a diagram and camera movement.'),
        h('div.row.end', go)))));

  root.append(h('section.page',
    h('div.crumbs', h('a', { href: '/styles', 'data-link': true }, 'Styles'), ' / New'),
    h('header.page-head', h('h1', 'New style')),
    form));
}

/** The style loop page: watch, comment, re-render, browse rounds, save, clone. */
async function styleView(root, { id }) {
  let stopJob = null;
  let viewing = null; // round number shown in the player; null = current
  const page = h('section.page');
  root.append(page);
  const { settings } = await api('/api/settings');

  async function load() {
    stopJob?.();
    stopJob = null;
    const [style, active] = await Promise.all([api(`/api/styles/${id}`), api(`/api/jobs?target=style:${id}&active=1`)]);
    const last = active[0] ? null : (await api(`/api/jobs?target=style:${id}`))[0];
    const current = style.rounds.find((r) => r.n === style.currentRound);
    const shown = style.rounds.find((r) => r.n === viewing) ?? current;
    const isCurrent = shown && current && shown.n === current.n;

    // ---- Player + job ----
    const shownType = shown?.outputType ?? 'video';
    const video = shown && shownType === 'video' ? h('video.sample', { src: shown.sampleUrl, controls: true, preload: 'auto', playsInline: true }) : null;
    const firstSample = h('button.btn.primary', { onclick: async () => {
      firstSample.disabled = true;
      try { await api(`/api/styles/${id}/sample`, { method: 'POST', body: {} }); await load(); } catch (err) { toast(err.message, 'error'); firstSample.disabled = false; }
    } }, 'Render first sample');
    const placeholder = active[0]?.kind === 'style-reference-video' ? 'Reading the reference video…' : active[0] ? 'Rendering the first sample…' : 'No sample yet.';
    const playerBox = video ? h('div.player', video)
      : shown ? (viewers[shownType] ?? viewers.video)(shown).el
      : h('div.player', h('div.placeholder', h('div.stack', h('div', placeholder), active[0] ? null : h('div', firstSample))));
    // Sample types: video first; deck/doc/visual samples render on demand and share the round history.
    const typeBar = style.rounds.length ? h('div.type-bar', { role: 'tablist', 'aria-label': 'Sample type' }, SAMPLE_TYPES.map((t) => {
      const latest = style.rounds.filter((r) => (r.outputType ?? 'video') === t.id).at(-1);
      return h('button.type-tab', {
        role: 'tab', 'aria-selected': String(shownType === t.id), disabled: !!active[0] && !latest,
        onclick: async () => {
          if (latest) { viewing = latest.n; load(); return; }
          try { await api(`/api/styles/${id}/sample`, { method: 'POST', body: { outputType: t.id } }); viewing = null; load(); }
          catch (err) { toast(err.message, 'error'); }
        },
      }, t.label, latest ? null : h('span.muted.small', ' · render sample'));
    })) : null;
    const jobBox = h('div');
    const job = active[0] ?? (last && last.status !== 'succeeded' && (!current || last.createdAt > current.createdAt) ? last : null);
    if (job) {
      const v = jobView(job.id, { onEnd: (j) => { if (j.status === 'succeeded') { viewing = null; load(); } }, onRetry: job.kind.startsWith('style-sample') ? () => rerender() : undefined });
      stopJob = v.stop;
      jobBox.append(v.el);
    }
    const seek = (ms) => { if (video) { video.currentTime = ms / 1000; video.play().catch(() => {}); } };

    // ---- Comments on the shown round ----
    const comments = h('div', shown?.comments.length
      ? shown.comments.map((c) => h('div.comment',
          c.atMs != null ? h('button.ts', { onclick: () => seek(c.atMs), title: 'Jump to this moment' }, fmtTs(c.atMs)) : h('span.ts', { style: { visibility: 'hidden' } }, '0:00.0'),
          h('span', { style: { flex: 1 } }, c.text),
          isCurrent && !active[0] ? h('button.btn.ghost.small', { 'aria-label': 'Remove comment', onclick: async () => { await api(`/api/styles/${id}/rounds/${shown.n}/comments/${c.id}`, { method: 'DELETE' }); load(); } }, '✕') : null))
      : h('p.muted.small', isCurrent ? 'No comments yet. What should change?' : 'No comments on this round.'));

    let composer = null;
    if (shown && isCurrent) {
      const text = h('textarea', { id: 'comment-text', placeholder: '“Voice is wrong”, “contrast too low”, “slower camera on the diagram”…' });
      const pin = h('input', { type: 'checkbox', id: 'comment-pin' });
      const pinLabel = h('span', 'Pin to 0:00.0');
      const updatePin = () => { pinLabel.textContent = `Pin to ${fmtTs((video?.currentTime ?? 0) * 1000)}`; };
      video?.addEventListener('timeupdate', updatePin);
      video?.addEventListener('seeked', updatePin);
      video?.addEventListener('pause', () => { pin.checked = true; updatePin(); });
      const add = h('button.btn', { type: 'submit' }, 'Add comment');
      composer = h('form.composer', {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!text.value.trim()) return;
          add.disabled = true;
          try {
            await api(`/api/styles/${id}/rounds/${shown.n}/comments`, { method: 'POST', body: { text: text.value, atMs: pin.checked && video ? Math.round(video.currentTime * 1000) : undefined } });
            await load();
            document.getElementById('comment-text')?.focus();
          } catch (err) { toast(err.message, 'error'); add.disabled = false; }
        },
      },
      h('label', { for: 'comment-text' }, 'Comment'), text,
      h('div.row', h('label', { for: 'comment-pin' }, pin, pinLabel), h('span', { style: { flex: 1 } }), add));
    }

    // ---- Next round controls ----
    let nextRound = null;
    if (current) {
      const modelSel = h('select', { id: 'next-model' }, settings.models.map((m) => h('option', { value: m.id, selected: m.id === style.model }, m.label)));
      const effortSel = h('select', { id: 'next-effort' }, settings.efforts.map((e) => h('option', { value: e, selected: e === style.effort }, e)));
      const voiceSel = h('select', { id: 'next-voice' }, h('option', { value: style.voice.voiceId }, style.voice.voiceId));
      api(`/api/tts/${style.voice.provider}/voices`).then((voices) => {
        voiceSel.replaceChildren(...voices.map((v) => h('option', { value: v.id, selected: v.id === style.voice.voiceId }, `${v.name} · ${v.language}`)));
      }).catch(() => {});
      const n = current.comments.length;
      const go = h('button.btn.primary', { disabled: !!active[0], onclick: () => rerender({
        model: modelSel.value, effort: effortSel.value,
        voice: voiceSel.value === style.voice.voiceId ? undefined : { provider: style.voice.provider, voiceId: voiceSel.value, controls: style.voice.controls },
      }) }, n ? `Re-render with ${n} comment${n === 1 ? '' : 's'}` : 'Re-render');
      nextRound = h('div.panel',
        h('div.panel-head', h('h3', `Next round`), h('span.muted.small', `builds on round ${current.n}`)),
        h('div.next-round',
          h('div.field', h('label', { for: 'next-voice' }, 'Next round voice'), voiceSel),
          h('div.field', h('label', { for: 'next-model' }, 'Next round model'), modelSel),
          h('div.field', h('label', { for: 'next-effort' }, 'Effort'), effortSel)),
        h('div.row.end', { style: { marginTop: '14px' } }, go));
    }

    // ---- Save ----
    let savePanel = null;
    if (!style.savedAt) {
      const nameInput = h('input', { id: 'save-name', value: style.name ?? '', placeholder: 'Name this style' });
      const chips = h('div.name-chips');
      const suggest = h('button.btn.small', { type: 'button', onclick: async () => {
        suggest.disabled = true;
        suggest.replaceChildren(h('span.spinner'), 'Thinking…');
        try {
          const { names } = await api(`/api/styles/${id}/name-suggestions`, { method: 'POST', body: {} });
          chips.replaceChildren(...names.map((n) => h('button.name-chip', { type: 'button', onclick: () => { nameInput.value = n; nameInput.focus(); } }, n)));
        } catch (err) { toast(err.message, 'error'); }
        suggest.disabled = false;
        suggest.replaceChildren('Suggest names');
      } }, 'Suggest names');
      savePanel = h('form.panel', {
        onsubmit: async (e) => {
          e.preventDefault();
          try { await api(`/api/styles/${id}/save`, { method: 'POST', body: { name: nameInput.value } }); toast('Style saved'); load(); }
          catch (err) { toast(err.message, 'error'); }
        },
      },
      h('div.panel-head', h('h3', 'Save'), h('span.badge.warn', 'draft')),
      h('div.field', h('label', { for: 'save-name' }, 'Style name'), nameInput, chips),
      h('div.row', suggest, h('span', { style: { flex: 1 } }), h('button.btn.primary', { type: 'submit' }, 'Save style')));
    }

    // ---- Rounds ----
    const rounds = h('div.rounds', [...style.rounds].reverse().map((r) => h('div.round', { class: r.n === style.currentRound ? 'current' : '' },
      h('strong', `Round ${r.n}`),
      h('span.grow.muted', r.summary || '—'),
      r.comments.length ? h('span.badge', `${r.comments.length} 💬`) : null,
      h('div.round-actions',
        r.n === shown?.n ? h('span.badge.accent', 'viewing') : h('button.btn.ghost.small', { onclick: () => { viewing = r.n; load(); } }, 'View'),
        r.n === style.currentRound ? null : h('button.btn.small', { disabled: !!active[0], onclick: async () => {
          try { await api(`/api/styles/${id}/revert`, { method: 'POST', body: { round: r.n } }); viewing = null; toast(`Round ${r.n} is current`); load(); }
          catch (err) { toast(err.message, 'error'); }
        } }, 'Make current')))));

    page.replaceChildren(
      h('div.crumbs', h('a', { href: '/styles', 'data-link': true }, 'Styles'), ' / ', styleTitle(style)),
      h('header.page-head',
        h('div', h('h1', styleTitle(style)), h('div.row.muted.small', swatches(style.palette),
          current ? `Round ${current.n} of ${style.rounds.length}` : 'No rounds yet',
          style.savedAt ? null : h('span.badge.warn', 'draft'),
          style.clonedFrom ? h('span.badge', 'clone') : null)),
        h('div.actions',
          h('button.btn', { onclick: clone }, 'Clone'),
          h('button.btn.danger', { onclick: () => remove(style) }, 'Delete'))),
      h('div.grid-2',
        h('div.stack',
          typeBar,
          playerBox,
          !isCurrent && shown ? h('div.viewing-note', `Viewing round ${shown.n}. Comments go on the current round (${current?.n}).`) : null,
          jobBox,
          shown ? h('div.panel',
            h('div.panel-head', h('h3', `Round ${shown.n}`), h('span.muted.small.round-meta', `${fmtMs(shown.durationMs)} · ${shown.voice.voiceId} · ${shown.model} · ${shown.effort} · ${timeAgo(shown.createdAt)}`)),
            shown.summary ? h('p', shown.summary) : null,
            comments, composer,
            h('details', { style: { marginTop: '12px' } }, h('summary.small', 'Scenes'),
              h('table.table', h('tbody', shown.scenes.map((s) => h('tr',
                h('td', h('button.ts', { onclick: () => seek(s.startMs ?? 0) }, fmtTs(s.startMs ?? 0))),
                h('td', h('strong', s.title), h('div.muted.small', s.narration)),
                h('td', (s.elements ?? []).map((e) => h('span.badge', e)))))))))
            : null,
          nextRound),
        h('div.stack',
          savePanel,
          style.rounds.length ? h('div.panel', h('h3', 'Rounds'), rounds) : null,
          h('div.panel',
            h('h3', 'Description'), h('p.muted.style-description', { style: { whiteSpace: 'pre-wrap' } }, style.description),
            h('dl.kv.small',
              h('dt', 'Voice'), h('dd', `${style.voice.provider} · ${style.voice.voiceId}`),
              h('dt', 'Model'), h('dd', `${style.model} · ${style.effort}`))),
          referencesPanel(style, { busy: !!active[0], onChange: load }),
          h('div.panel',
            h('details', { open: !style.rounds.length }, h('summary', 'Style instructions (DESIGN.md)'), h('pre.doc', style.design))))));
  }

  async function rerender(body = {}) {
    try {
      await api(`/api/styles/${id}/rerender`, { method: 'POST', body });
      viewing = null;
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function clone() {
    try {
      const copy = await api(`/api/styles/${id}/clone`, { method: 'POST', body: {} });
      toast('Cloned');
      navigate(`/styles/${copy.id}`);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function remove(style) {
    const res = await fetch(`/api/styles/${id}`, { method: 'DELETE', headers: { 'x-explainer': '1' } });
    if (res.ok) { toast('Style deleted'); navigate('/styles'); return; }
    const body = await res.json().catch(() => ({}));
    if (res.status !== 409 || !body.usedBy) { toast(body.error ?? 'Delete failed', 'error'); return; }
    const ok = await dialog({
      title: `Delete “${styleTitle(style)}”?`,
      body: [h('p', `These explainers use this style. They keep their outputs, but can no longer re-render in it:`), h('ul', body.usedBy.map((e) => h('li', e.title)))],
      actions: [{ label: 'Delete anyway', value: true, kind: 'danger' }],
    });
    if (!ok) return;
    try { await api(`/api/styles/${id}?force=1`, { method: 'DELETE' }); toast('Style deleted'); navigate('/styles'); }
    catch (err) { toast(err.message, 'error'); }
  }

  await load();
  return () => stopJob?.();
}

registerRoute(/^\/styles$/, stylesView);
registerRoute(/^\/styles\/new$/, newStyleView);
registerRoute(/^\/styles\/(?<id>st_\w+)$/, styleView);
