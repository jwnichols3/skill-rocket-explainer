import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { getSettings } from '../components/pickers.js';

export async function settingsView(root) {
  const [{ settings, available }, secrets] = await Promise.all([api('/api/settings'), api('/api/secrets')]);
  const ttsDd = h('dd', settings.providers.tts);
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Settings')),
    h('div.panel',
      h('h2', 'Providers'),
      h('dl.kv',
        h('dt', 'Agent surface'), h('dd', settings.providers.agent),
        h('dt', 'Voice provider'), ttsDd,
        h('dt', 'Video renderer'), h('dd', settings.providers.renderer.video))),
    voiceProviders(settings, available.tts, secrets, (id) => { ttsDd.textContent = id; })));
}

const SECRET_LABELS = { apiKey: 'API key' };

/** Default TTS provider, plus a write-only field for each secret a provider declares. */
function voiceProviders(settings, providers, secrets, onDefault) {
  const select = h('select', { id: 'default-tts' }, providers.map((p) => h('option', { value: p.id, selected: p.id === settings.providers.tts }, p.label)));
  select.addEventListener('change', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { providers: { tts: select.value } } });
      await getSettings(true);
      onDefault(select.value);
      toast('Default voice provider saved');
    } catch (err) { toast(err.message, 'error'); }
  });

  return h('div.panel.voice-providers',
    h('h2', 'Voice providers'),
    h('div.field', h('label', { for: 'default-tts' }, 'Default voice provider'), select,
      h('div.hint', 'New styles start with this provider; each style can pick its own.')),
    providers.filter((p) => p.secrets?.length).flatMap((p) => p.secrets.map((name) => secretField(p, name, secrets[p.id]?.[name] === 'set'))));
}

/** The value is never sent back by the server; the field only shows whether one is set. */
function secretField(provider, name, isSet) {
  const id = `secret-${provider.id}-${name}`;
  const label = `${provider.label} ${SECRET_LABELS[name] ?? name}`;
  const input = h('input', { id, type: 'password', autocomplete: 'off', spellcheck: 'false' });
  const badge = h('span.badge');
  const clearBtn = h('button.btn.small', { type: 'button' }, 'Clear');
  const render = (set) => {
    badge.textContent = set ? 'set' : 'not set';
    badge.className = `badge secret-status ${set ? 'ok' : 'warn'}`;
    input.placeholder = set ? 'Saved. Enter a new key to replace it.' : `Paste your ${label}`;
    clearBtn.disabled = !set;
  };
  const save = async (value) => {
    try {
      const status = await api(`/api/secrets/${encodeURIComponent(provider.id)}`, { method: 'PUT', body: { [name]: value } });
      input.value = '';
      render(status[name] === 'set');
      toast(value ? `${label} saved` : `${label} cleared`);
    } catch (err) { toast(err.message, 'error'); }
  };
  clearBtn.addEventListener('click', () => save(''));
  const saveBtn = h('button.btn.small.primary', { type: 'button', onclick: () => { if (input.value.trim()) save(input.value.trim()); else input.focus(); } }, 'Save');
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBtn.click(); });
  render(isSet);
  return h('div.field.secret', { 'data-provider': provider.id },
    h('div.row', { style: { marginBottom: '6px' } }, h('label', { for: id, style: { margin: 0 } }, label), badge),
    h('div.row', h('div', { style: { flex: 1 } }, input), saveBtn, clearBtn),
    h('div.hint', 'Stored in secrets.json in your data dir, readable only by you. Never shown again after saving.'));
}
