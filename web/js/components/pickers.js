import { h } from '../dom.js';
import { api } from '../api.js';

let settingsCache = null;
export async function getSettings(force = false) {
  if (!settingsCache || force) settingsCache = await api('/api/settings');
  return settingsCache;
}

function field(label, control, hint) {
  const id = control.id || `f-${Math.random().toString(36).slice(2, 8)}`;
  control.id = id;
  return h('div.field', h('label', { for: id }, label), control, hint ? h('div.hint', hint) : null);
}

/** Model + effort dropdowns. */
export async function modelPicker(initial = {}) {
  const { settings } = await getSettings();
  const model = h('select', settings.models.map((m) => h('option', { value: m.id, selected: m.id === (initial.model ?? settings.defaults.model) }, m.label)));
  const effort = h('select', settings.efforts.map((e) => h('option', { value: e, selected: e === (initial.effort ?? settings.defaults.effort) }, e)));
  const el = h('div.row', { style: { alignItems: 'flex-start' } },
    h('div', { style: { flex: 2 } }, field('Model', model)),
    h('div', { style: { flex: 1 } }, field('Effort', effort)));
  return { el, value: () => ({ model: model.value, effort: effort.value }), model, effort };
}

/**
 * TTS provider, voice and the controls that voice supports. Unsupported controls are
 * disabled with the reason. Preview button (on by default) plays a short line.
 */
export async function voicePicker(initial = {}, { preview = true } = {}) {
  const { settings, available } = await getSettings();
  const provider = h('select', available.tts.map((p) => h('option', { value: p.id, selected: p.id === (initial.provider ?? settings.providers.tts) }, p.label)));
  const voice = h('select');
  const controlsBox = h('div.controls');
  const previewBtn = h('button.btn.small', { type: 'button' }, '▶ Preview voice');
  const previewAudio = h('audio', { class: 'voice-preview', controls: true, hidden: true, style: { width: '100%', marginTop: '8px' } });
  let controls = {};
  let caps = null;

  async function loadVoices(selectId) {
    voice.replaceChildren(h('option', 'Loading…'));
    try {
      const voices = await api(`/api/tts/${provider.value}/voices`);
      voice.replaceChildren(...voices.map((v) => h('option', { value: v.id, selected: v.id === selectId },
        `${v.name} · ${v.language}${v.engine ? ` · ${v.engine}` : ''}${v.gender ? ` · ${v.gender}` : ''}`)));
      if (!voices.length) voice.replaceChildren(h('option', { value: '' }, 'No voices'));
    } catch (err) {
      voice.replaceChildren(h('option', { value: '' }, `Unavailable: ${err.message}`));
    }
    await loadCaps();
  }

  async function loadCaps() {
    controlsBox.replaceChildren();
    if (!voice.value) return;
    try { caps = await api(`/api/tts/${provider.value}/voices/${encodeURIComponent(voice.value)}/capabilities`); }
    catch (err) { controlsBox.append(h('div.callout.error', err.message)); return; }
    const next = {};
    for (const key of ['rate', 'pitch', 'volume']) {
      const range = caps.controls[key];
      const id = `ctl-${key}`;
      if (range) {
        const val = initial.controls?.[key] ?? range.default;
        next[key] = val;
        const out = h('output', `${val}${range.unit}`);
        const input = h('input', { type: 'range', id, min: range.min, max: range.max, step: range.step, value: val,
          oninput: () => { controls[key] = Number(input.value); out.textContent = `${input.value}${range.unit}`; } });
        controlsBox.append(h('div.control', h('label', { for: id }, cap(key)), input, out));
      } else {
        controlsBox.append(h('div.control.disabled',
          h('label', { for: id }, cap(key)), h('input', { type: 'range', id, disabled: true }), h('output', '—'),
          h('div.why', caps.unsupported[key] ?? 'Not supported by this voice.')));
      }
    }
    const styleId = 'ctl-style';
    if (caps.styles.length) {
      const sel = h('select', { id: styleId, onchange: () => { controls.style = sel.value || undefined; } },
        h('option', { value: '' }, 'Default'), caps.styles.map((s) => h('option', { value: s, selected: s === initial.controls?.style }, s)));
      if (initial.controls?.style) next.style = initial.controls.style;
      controlsBox.append(h('div.control', h('label', { for: styleId }, 'Style'), sel, h('output')));
    } else {
      controlsBox.append(h('div.control.disabled', h('label', { for: styleId }, 'Style'), h('select', { id: styleId, disabled: true }, h('option', 'Default')), h('output'),
        h('div.why', caps.unsupported.style ?? 'No speaking styles for this voice.')));
    }
    controls = next;
  }

  provider.addEventListener('change', () => { initial = {}; loadVoices(); });
  voice.addEventListener('change', () => { initial = { ...initial, controls: {} }; loadCaps(); });
  previewBtn.addEventListener('click', async () => {
    previewBtn.disabled = true;
    previewBtn.textContent = 'Synthesizing…';
    try {
      const r = await api('/api/tts/preview', { method: 'POST', body: value() });
      previewAudio.hidden = false;
      previewAudio.src = r.url;
      await previewAudio.play().catch(() => {});
    } catch (err) {
      previewAudio.hidden = true;
      controlsBox.append(h('div.callout.error', `Preview failed: ${err.message}`));
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = '▶ Preview voice';
    }
  });

  function value() { return { provider: provider.value, voiceId: voice.value, controls: { ...controls } }; }

  await loadVoices(initial.voiceId);
  const el = h('div.voice-picker',
    field('Voice provider', provider),
    field('Voice', voice),
    controlsBox,
    preview ? h('div', previewBtn, previewAudio) : null);
  return { el, value };
}

function cap(s) { return s[0].toUpperCase() + s.slice(1); }

const OTHER = '__other__';

/**
 * A dropdown of known values plus "Other…", which reveals a text field. A current value that
 * isn't in the list shows as Other with the value filled in, so nothing saved is lost.
 * `none` adds a first, empty choice (e.g. "not mapped").
 */
export function selectWithOther({ id, label, options = [], value = '', none, placeholder = '', onChange }) {
  const get = () => (select.value === OTHER ? input.value.trim() : select.value);
  const input = h('input.mono', { type: 'text', placeholder, 'aria-label': `${label}, other value`, oninput: () => onChange?.(get()) });
  const select = h('select', { id, 'aria-label': label, onchange() {
    input.hidden = select.value !== OTHER;
    if (!input.hidden) input.focus();
    onChange?.(get());
  } });
  function show(v) {
    const known = (none !== undefined && v === '') || [...select.options].some((o) => o.value === v && v !== OTHER);
    select.value = known ? v : OTHER;
    if (!known) input.value = v;
    input.hidden = select.value !== OTHER;
  }
  function setOptions(opts, keep = get()) {
    select.replaceChildren(
      ...(none !== undefined ? [h('option', { value: '' }, none)] : []),
      ...opts.map((o) => h('option', { value: o.value }, o.label ?? o.value)),
      h('option', { value: OTHER }, 'Other…'));
    show(keep);
  }
  setOptions(options, value);
  return { el: h('div.select-other', select, input), setOptions, get value() { return get(); }, set value(v) { show(v); } };
}
