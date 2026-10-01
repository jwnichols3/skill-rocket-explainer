import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { getSettings } from '../components/pickers.js';

export async function settingsView(root) {
  const { settings, available } = await api('/api/settings');
  const videoRenderers = available.renderer.filter((r) => r.outputTypes.includes('video'));
  const renderer = h('select', {
    id: 'video-renderer',
    async onchange() {
      try {
        await api('/api/settings', { method: 'PUT', body: { providers: { renderer: { video: renderer.value } } } });
        toast(`Video renderer: ${renderer.selectedOptions[0].textContent}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  }, videoRenderers.map((r) => h('option', { value: r.id, selected: r.id === settings.providers.renderer.video }, r.label)));
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Settings')),
    h('div.panel',
      h('h2', 'Providers'),
      h('dl.kv',
        h('dt', 'Agent surface'), h('dd', settings.providers.agent),
        h('dt', 'Voice provider'), h('dd', settings.providers.tts),
        h('dt', h('label', { for: 'video-renderer' }, 'Video renderer')), h('dd', renderer)))));
  const surfaces = agentSurfacesPanel(settings, available);
  root.lastElementChild.append(surfaces.el, modelsPanel(settings, (models) => surfaces.setModels(models)));
}

async function saveSettings(body, ok) {
  try {
    const r = await api('/api/settings', { method: 'PUT', body });
    await getSettings(true).catch(() => {});
    toast(ok);
    return r.settings;
  } catch (err) {
    toast(err.message, 'error');
    return null;
  }
}

/** Default agent surface, and the Bedrock surface's AWS profile, region and model -> inference profile mapping. */
function agentSurfacesPanel(settings, available) {
  const surface = h('select', { id: 'default-surface', onchange: () => saveSettings({ providers: { agent: surface.value } }, `Default agent surface: ${surface.selectedOptions[0].textContent}`) },
    available.agent.map((a) => h('option', { value: a.id, selected: a.id === settings.providers.agent }, a.label)));

  const b = settings.bedrock;
  const profile = h('select', { id: 'bedrock-profile' });
  const setProfiles = (list) => {
    if (b.profile && !list.some((p) => p.name === b.profile)) list = [{ name: b.profile }, ...list];
    profile.replaceChildren(h('option', { value: '' }, '(default profile)'),
      ...list.map((p) => h('option', { value: p.name, selected: p.name === b.profile }, `${p.name}${p.region ? ` · ${p.region}` : ''}${p.sso ? ' · SSO' : ''}`)));
  };
  setProfiles([]);
  api('/api/bedrock/profiles').then((r) => setProfiles(r.profiles), (err) => toast(`AWS profiles: ${err.message}`, 'error'));
  const region = h('input', { id: 'bedrock-region', value: b.region, placeholder: 'us-east-1' });

  const list = h('datalist', { id: 'bedrock-inference-profiles' });
  const status = h('div.hint', 'Discover lists the inference profiles this AWS profile can use in the region, Anthropic Claude first.');
  const inputs = new Map();
  const mapping = h('tbody');
  const setModels = (models) => {
    const typed = Object.fromEntries([...inputs].map(([id, i]) => [id, i.value]));
    inputs.clear();
    mapping.replaceChildren(...models.map((m) => {
      const input = h('input', { list: 'bedrock-inference-profiles', value: typed[m.id] ?? b.models[m.id] ?? '', placeholder: 'not mapped', class: 'mono', 'aria-label': `Inference profile for ${m.label || m.id}` });
      inputs.set(m.id, input);
      return h('tr', h('td', m.label || m.id, h('div.small.muted.mono', m.id)), h('td', input));
    }));
  };
  setModels(settings.models);

  const discover = h('button.btn.small', { type: 'button', async onclick() {
    discover.disabled = true;
    status.textContent = 'Asking Bedrock…';
    try {
      const r = await api(`/api/bedrock/inference-profiles?profile=${encodeURIComponent(profile.value)}&region=${encodeURIComponent(region.value.trim())}`);
      list.replaceChildren(...r.inferenceProfiles.map((p) => h('option', { value: p.id }, p.name)));
      let filled = 0;
      for (const [id, input] of inputs) if (!input.value && r.suggested[id]) { input.value = r.suggested[id]; filled++; }
      status.textContent = `Found ${r.inferenceProfiles.length} inference profiles (${r.inferenceProfiles.filter((p) => p.anthropic).length} Anthropic Claude)${filled ? `; filled ${filled} mapping${filled === 1 ? '' : 's'}, save to keep them` : ''}.`;
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'error');
    } finally { discover.disabled = false; }
  } }, 'Discover');
  const save = h('button.btn.small.primary', { type: 'button', async onclick() {
    const models = Object.fromEntries([...inputs].map(([id, i]) => [id, i.value.trim()]));
    const next = await saveSettings({ bedrock: { profile: profile.value, region: region.value.trim(), models } }, 'Bedrock settings saved');
    if (next) Object.assign(b, next.bedrock);
  } }, 'Save Bedrock settings');

  const el = h('div.panel.agent-surfaces',
    h('h2', 'Agent surfaces'),
    h('div.field', h('label', { for: 'default-surface' }, 'Default agent surface'), surface,
      h('div.hint', 'New explainers run here; each explainer can pick its own under Choices > Runs on.')),
    h('h3', 'Amazon Bedrock'),
    h('div.row', { style: { alignItems: 'flex-start' } },
      h('div.field', { style: { flex: 2 } }, h('label', { for: 'bedrock-profile' }, 'AWS profile'), profile),
      h('div.field', { style: { flex: 1 } }, h('label', { for: 'bedrock-region' }, 'Region'), region)),
    h('table.table', h('thead', h('tr', h('th', 'Model'), h('th', 'Inference profile'))), mapping),
    list,
    h('div.row', { style: { marginTop: '10px' } }, discover, save),
    status);
  return { el, setModels };
}

/** Model list (id + label, ordered), default model and default effort. */
function modelsPanel(settings, onSaved) {
  let rows = settings.models.map((m) => ({ ...m }));
  let chosen = settings.defaults.model;
  const body = h('tbody');
  const defModel = h('select', { id: 'default-model', onchange: () => { chosen = defModel.value; } });
  const defEffort = h('select', { id: 'default-effort' }, settings.efforts.map((e) => h('option', { value: e, selected: e === settings.defaults.effort }, e)));

  const refreshDefault = () => {
    const named = rows.filter((r) => r.id);
    if (!named.some((r) => r.id === chosen)) chosen = named[0]?.id ?? '';
    defModel.replaceChildren(...named.map((r) => h('option', { value: r.id, selected: r.id === chosen }, r.label || r.id)));
  };
  const move = (i, d) => { [rows[i], rows[i + d]] = [rows[i + d], rows[i]]; render(); };
  function render() {
    body.replaceChildren(...rows.map((r, i) => {
      const up = h('button.btn.ghost.small', { type: 'button', disabled: i === 0, onclick: () => move(i, -1) }, '↑');
      const down = h('button.btn.ghost.small', { type: 'button', disabled: i === rows.length - 1, onclick: () => move(i, 1) }, '↓');
      const remove = h('button.btn.ghost.small', { type: 'button', disabled: rows.length === 1, onclick: () => { rows.splice(i, 1); render(); } }, '✕');
      const name = () => {
        const n = r.label.trim() || r.id || `model ${i + 1}`;
        up.setAttribute('aria-label', `Move ${n} up`);
        down.setAttribute('aria-label', `Move ${n} down`);
        remove.setAttribute('aria-label', `Remove ${n}`);
      };
      name();
      return h('tr.model-row',
        h('td', h('input', { value: r.id, placeholder: 'claude-…', class: 'mono', 'aria-label': `Model id ${i + 1}`, oninput: (e) => { r.id = e.target.value.trim(); name(); }, onchange: refreshDefault })),
        h('td', h('input', { value: r.label, placeholder: 'Label', 'aria-label': `Model label ${i + 1}`, oninput: (e) => { r.label = e.target.value; name(); }, onchange: refreshDefault })),
        h('td', { style: { whiteSpace: 'nowrap' } }, up, down, remove));
    }));
    refreshDefault();
  }
  render();

  const add = h('button.btn.small', { type: 'button', onclick: () => { rows.push({ id: '', label: '' }); render(); body.lastElementChild?.querySelector('input')?.focus(); } }, 'Add model');
  const save = h('button.btn.small.primary', { type: 'button', async onclick() {
    const models = rows.filter((r) => r.id).map((r) => ({ id: r.id, label: r.label.trim() || r.id }));
    const next = await saveSettings({ models, defaults: { model: defModel.value, effort: defEffort.value } }, 'Models saved');
    if (next) { rows = next.models.map((m) => ({ ...m })); chosen = next.defaults.model; render(); onSaved(next.models); }
  } }, 'Save models');

  return h('div.panel.models',
    h('h2', 'Models'),
    h('table.table', h('thead', h('tr', h('th', 'Model id'), h('th', 'Label'), h('th', h('span.sr', 'Actions')))), body),
    h('div.row', { style: { marginTop: '10px' } }, add),
    h('div.row', { style: { alignItems: 'flex-start', marginTop: '12px' } },
      h('div.field', { style: { flex: 2 } }, h('label', { for: 'default-model' }, 'Default model'), defModel),
      h('div.field', { style: { flex: 1 } }, h('label', { for: 'default-effort' }, 'Default effort'), defEffort)),
    h('div.row', save));
}
