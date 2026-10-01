import { h, toast, timeAgo, fmtMs } from '../dom.js';
import { api } from '../api.js';
import { navigate, registerRoute } from '../router.js';
import { jobView } from '../components/job.js';
import { voicePicker, modelPicker } from '../components/pickers.js';

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

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!description.value.trim()) { toast('Describe the style first', 'error'); description.focus(); return; }
      go.disabled = true;
      try {
        const style = await api('/api/styles', { method: 'POST', body: { name: later.checked ? null : name.value || null, description: description.value, voice: voice.value(), ...model.value() } });
        await api(`/api/styles/${style.id}/sample`, { method: 'POST', body: {} });
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
          h('div.hint', 'Concrete beats vague: “titles slam in, neon blue/green on near-black, slow camera push-ins, a dry joke per scene”.')))),
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

/** The style loop page. */
async function styleView(root, { id }) {
  let stopJob = null;
  const page = h('section.page');
  root.append(page);

  async function load() {
    stopJob?.();
    stopJob = null;
    const [style, active] = await Promise.all([api(`/api/styles/${id}`), api(`/api/jobs?target=style:${id}&active=1`)]);
    const last = active[0] ? null : (await api(`/api/jobs?target=style:${id}`))[0];
    const current = style.rounds.find((r) => r.n === style.currentRound);

    const playerBox = h('div.player');
    if (current) {
      playerBox.append(h('video.sample', { src: current.sampleUrl, controls: true, preload: 'auto', playsInline: true }));
    } else {
      playerBox.append(h('div.placeholder', active[0] ? 'Rendering the first sample…' : 'No sample yet.'));
    }

    const jobBox = h('div');
    const job = active[0] ?? (last && last.status !== 'succeeded' && (!current || last.createdAt > current.createdAt) ? last : null);
    if (job) {
      const v = jobView(job.id, {
        onEnd: (j) => { if (j.status === 'succeeded') load(); },
        onRetry: () => startSample(),
      });
      stopJob = v.stop;
      jobBox.append(v.el);
    }

    page.replaceChildren(
      h('div.crumbs', h('a', { href: '/styles', 'data-link': true }, 'Styles'), ' / ', styleTitle(style)),
      h('header.page-head',
        h('div', h('h1', styleTitle(style)), h('div.row.muted.small', swatches(style.palette),
          current ? `Round ${current.n} of ${style.rounds.length}` : 'No rounds yet',
          style.savedAt ? null : h('span.badge.warn', 'draft')))),
      h('div.grid-2',
        h('div.stack', playerBox, jobBox,
          current ? h('div.panel',
            h('div.panel-head', h('h3', `Round ${current.n}`), h('span.muted.small', `${fmtMs(current.durationMs)} · ${current.model} · ${current.effort} · ${timeAgo(current.createdAt)}`)),
            current.summary ? h('p', current.summary) : null,
            h('details', h('summary.small', 'Scenes'),
              h('table.table', h('tbody', current.scenes.map((s) => h('tr',
                h('td.mono', fmtMs(s.startMs)), h('td', h('strong', s.title), h('div.muted.small', s.narration)),
                h('td', (s.elements ?? []).map((e) => h('span.badge', e)))))))))
            : null),
        h('div.stack',
          h('div.panel',
            h('h3', 'Description'), h('p.muted', style.description),
            h('dl.kv.small',
              h('dt', 'Voice'), h('dd', `${style.voice.provider} · ${style.voice.voiceId}`),
              h('dt', 'Model'), h('dd', `${style.model} · ${style.effort}`))),
          h('div.panel',
            h('details', h('summary', 'Style instructions (DESIGN.md)'), h('pre.doc', style.design))))));
  }

  async function startSample() {
    try {
      await api(`/api/styles/${id}/sample`, { method: 'POST', body: {} });
      await load();
    } catch (err) { toast(err.message, 'error'); }
  }

  await load();
  return () => stopJob?.();
}

registerRoute(/^\/styles$/, stylesView);
registerRoute(/^\/styles\/new$/, newStyleView);
registerRoute(/^\/styles\/(?<id>st_\w+)$/, styleView);
