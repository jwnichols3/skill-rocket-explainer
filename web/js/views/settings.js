import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { getSettings, selectWithOther } from '../components/pickers.js';
import { jobView } from '../components/job.js';

export async function settingsView(root) {
  const [{ settings, available }, secrets] = await Promise.all([api('/api/settings'), api('/api/secrets')]);
  const TYPES = [['video', 'Video renderer'], ['deck', 'Deck renderer'], ['doc', 'Briefing doc renderer'], ['visual', 'Visual renderer']];
  const rendererPicker = (type, label) => {
    const select = h('select', {
      id: `${type}-renderer`,
      async onchange() {
        try {
          await api('/api/settings', { method: 'PUT', body: { providers: { renderer: { [type]: select.value } } } });
          toast(`${label}: ${select.selectedOptions[0].textContent}`);
        } catch (err) {
          toast(err.message, 'error');
        }
      },
    }, available.renderer.filter((r) => r.outputTypes.includes(type)).map((r) => h('option', { value: r.id, selected: r.id === settings.providers.renderer[type] }, r.label)));
    return [h('dt', h('label', { for: `${type}-renderer` }, label)), h('dd', select)];
  };
  const surfaces = agentSurfacesPanel(settings, available);
  // One section at a time; the tab lives in the URL hash so reloads and links land on it.
  const sections = [
    ['models', 'Models & agents', [surfaces.el, modelsPanel(settings, (models) => surfaces.setModels(models))]],
    ['voices', 'Voices', [voiceProviders(settings, available.tts, secrets)]],
    ['rendering', 'Rendering', [h('div.panel', h('h2', 'Renderers'), h('p.hint', 'Which renderer makes each output type.'), h('dl.kv', TYPES.map(([type, label]) => rendererPicker(type, label))))]],
    ['about', 'About', [versionPanel()]],
  ];
  const tabs = {};
  const panels = {};
  const show = (id, { remember = true } = {}) => {
    if (!panels[id]) id = sections[0][0];
    for (const [k] of sections) {
      tabs[k].setAttribute('aria-selected', String(k === id));
      panels[k].hidden = k !== id;
    }
    if (remember && location.hash.slice(1) !== id) history.replaceState(history.state, '', `#${id}`);
  };
  const bar = h('div.tabs', { role: 'tablist', 'aria-label': 'Settings sections' }, sections.map(([id, label]) =>
    (tabs[id] = h('button', { type: 'button', role: 'tab', id: `tab-${id}`, 'aria-controls': `section-${id}`, onclick: () => show(id) }, label))));
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Settings'), h('div.actions', h('a.btn', { href: '/setup', 'data-link': true }, 'Setup'), h('a.btn', { href: '/diagnostics', 'data-link': true }, 'Diagnostics'))),
    bar,
    sections.map(([id, , content]) => (panels[id] = h('div.stack', { role: 'tabpanel', id: `section-${id}`, 'aria-labelledby': `tab-${id}` }, content)))));
  // Plain /settings stays plain until a tab is picked.
  show(location.hash.slice(1), { remember: !!location.hash });
}

const SECRET_LABELS = { apiKey: 'API key' };

/** Default TTS provider, plus a write-only field for each secret a provider declares. */
function voiceProviders(settings, providers, secrets) {
  const select = h('select', { id: 'default-tts' }, providers.map((p) => h('option', { value: p.id, selected: p.id === settings.providers.tts }, p.label)));
  select.addEventListener('change', async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { providers: { tts: select.value } } });
      await getSettings(true);
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

// Regions where Bedrock runs Anthropic models; "Other…" covers any added later.
const BEDROCK_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2', 'us-gov-west-1', 'ca-central-1', 'sa-east-1',
  'eu-central-1', 'eu-central-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3', 'ap-south-1', 'ap-south-2', 'ap-southeast-1', 'ap-southeast-2'];

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
  const region = selectWithOther({ id: 'bedrock-region', label: 'Region', options: BEDROCK_REGIONS.map((r) => ({ value: r })), value: b.region, placeholder: 'us-east-1' });

  // Until Discover runs, the choices are the saved mappings; afterwards, what Bedrock offers.
  let profileOptions = [...new Set(Object.values(b.models).filter(Boolean))].map((v) => ({ value: v }));
  const status = h('div.hint', 'Discover lists the inference profiles this AWS profile can use in the region, Anthropic Claude first.');
  const inputs = new Map();
  const mapping = h('tbody');
  const setModels = (models) => {
    const typed = Object.fromEntries([...inputs].map(([id, i]) => [id, i.value]));
    inputs.clear();
    mapping.replaceChildren(...models.map((m) => {
      const picker = selectWithOther({ label: `Inference profile for ${m.label || m.id}`, options: profileOptions, value: typed[m.id] ?? b.models[m.id] ?? '', none: 'not mapped', placeholder: 'inference profile id or ARN' });
      inputs.set(m.id, picker);
      return h('tr', h('td', m.label || m.id, h('div.small.muted.mono', m.id)), h('td', picker.el));
    }));
  };
  setModels(settings.models);

  const discover = h('button.btn.small', { type: 'button', async onclick() {
    discover.disabled = true;
    status.textContent = 'Asking Bedrock…';
    try {
      const r = await api(`/api/bedrock/inference-profiles?profile=${encodeURIComponent(profile.value)}&region=${encodeURIComponent(region.value)}`);
      profileOptions = r.inferenceProfiles.map((p) => ({ value: p.id, label: `${p.name} · ${p.id}` }));
      for (const picker of inputs.values()) picker.setOptions(profileOptions);
      let filled = 0;
      for (const [id, input] of inputs) if (!input.value && r.suggested[id]) { input.value = r.suggested[id]; filled++; }
      status.textContent = `Found ${r.inferenceProfiles.length} inference profiles (${r.inferenceProfiles.filter((p) => p.anthropic).length} Anthropic Claude)${filled ? `; filled ${filled} mapping${filled === 1 ? '' : 's'}, save to keep them` : ''}.`;
    } catch (err) {
      status.textContent = '';
      toast(err.message, 'error');
    } finally { discover.disabled = false; }
  } }, 'Discover');
  const save = h('button.btn.small.primary', { type: 'button', async onclick() {
    const models = Object.fromEntries([...inputs].map(([id, i]) => [id, i.value]));
    const next = await saveSettings({ bedrock: { profile: profile.value, region: region.value, models } }, 'Bedrock settings saved');
    if (next) Object.assign(b, next.bedrock);
  } }, 'Save Bedrock settings');

  const el = h('div.panel.agent-surfaces',
    h('h2', 'Agent surfaces'),
    h('div.field', h('label', { for: 'default-surface' }, 'Default agent surface'), surface,
      h('div.hint', 'New explainers run here; each explainer can pick its own under Choices > Runs on.')),
    h('h3', 'Amazon Bedrock'),
    h('div.row', { style: { alignItems: 'flex-start' } },
      h('div.field', { style: { flex: 2 } }, h('label', { for: 'bedrock-profile' }, 'AWS profile'), profile),
      h('div.field', { style: { flex: 1 } }, h('label', { for: 'bedrock-region' }, 'Region'), region.el)),
    h('table.table', h('thead', h('tr', h('th', 'Model'), h('th', 'Inference profile'))), mapping),
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
  // Choices for the id column: the available-models catalog (built-in, plus Bedrock once refreshed).
  let catalog = [];
  const catalogStatus = h('span.hint', { 'aria-live': 'polite' });
  const idPickers = [];
  const idOptions = () => catalog.map((m) => ({ value: m.id, label: `${m.label} · ${m.id}` }));
  const showCatalog = (c) => {
    catalog = c.models;
    for (const p of idPickers) p.setOptions(idOptions());
    const fromBedrock = c.models.filter((m) => m.sources.includes('bedrock')).length;
    catalogStatus.replaceChildren(c.fetchedAt
      ? `${c.models.length} models (${fromBedrock} on Bedrock) · updated ${new Date(c.fetchedAt).toLocaleString()}`
      : `${c.models.length} built-in models. Refresh to add what Bedrock offers.`,
    ...c.problems.map((p) => h('div.callout.warn.small', p.message)));
  };
  api('/api/models/available').then(showCatalog, (err) => toast(`Models: ${err.message}`, 'error'));
  const refreshList = h('button.btn.small', { type: 'button', async onclick() {
    refreshList.disabled = true;
    catalogStatus.textContent = 'Refreshing…';
    try { showCatalog(await api('/api/models/available/refresh', { method: 'POST', body: {} })); }
    catch (err) { catalogStatus.textContent = ''; toast(err.message, 'error'); }
    finally { refreshList.disabled = false; }
  } }, 'Refresh list');

  const move = (i, d) => { [rows[i], rows[i + d]] = [rows[i + d], rows[i]]; render(); };
  function render() {
    idPickers.length = 0;
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
      const labelInput = h('input', { value: r.label, placeholder: 'Label', 'aria-label': `Model label ${i + 1}`, oninput: (e) => { r.label = e.target.value; name(); }, onchange: refreshDefault });
      const idPicker = selectWithOther({ label: `Model id ${i + 1}`, options: idOptions(), value: r.id, none: r.id ? undefined : 'Choose a model…', placeholder: 'claude-…', onChange(v) {
        // Picking a listed model names it, unless the label was typed by hand.
        const known = catalog.find((m) => m.id === v);
        const before = catalog.find((m) => m.id === r.id);
        if (known && (!r.label.trim() || r.label === before?.label)) { r.label = known.label; labelInput.value = known.label; }
        r.id = v;
        name();
        refreshDefault();
      } });
      idPickers.push(idPicker);
      return h('tr.model-row',
        h('td', idPicker.el),
        h('td', labelInput),
        h('td', { style: { whiteSpace: 'nowrap' } }, up, down, remove));
    }));
    refreshDefault();
  }
  render();

  const add = h('button.btn.small', { type: 'button', onclick: () => { rows.push({ id: '', label: '' }); render(); body.lastElementChild?.querySelector('select')?.focus(); } }, 'Add model');
  const save = h('button.btn.small.primary', { type: 'button', async onclick() {
    const models = rows.filter((r) => r.id).map((r) => ({ id: r.id, label: r.label.trim() || r.id }));
    const next = await saveSettings({ models, defaults: { model: defModel.value, effort: defEffort.value } }, 'Models saved');
    if (next) { rows = next.models.map((m) => ({ ...m })); chosen = next.defaults.model; render(); onSaved(next.models); }
  } }, 'Save models');

  return h('div.panel.models',
    h('h2', 'Models'),
    h('div.row', { style: { alignItems: 'center', marginBottom: '8px' } }, refreshList, catalogStatus),
    h('table.table', h('thead', h('tr', h('th', 'Model id'), h('th', 'Label'), h('th', h('span.sr', 'Actions')))), body),
    h('div.row', { style: { marginTop: '10px' } }, add),
    h('div.row', { style: { alignItems: 'flex-start', marginTop: '12px' } },
      h('div.field', { style: { flex: 2 } }, h('label', { for: 'default-model' }, 'Default model'), defModel),
      h('div.field', { style: { flex: 1 } }, h('label', { for: 'default-effort' }, 'Default effort'), defEffort)),
    h('div.row', save));
}

/** Installed version, "Check for update" against the latest GitHub release, install and restart. */
function versionPanel() {
  const installed = h('dd', { id: 'installed-version' }, '…');
  api('/api/status').then((s) => { installed.textContent = `v${s.version}`; }, () => {});
  const result = h('div.update-result', { 'aria-live': 'polite', style: { marginTop: '10px' } });

  const restart = (version) => h('button.btn.small.primary', { type: 'button', async onclick(e) {
    e.target.disabled = true;
    try {
      await api('/api/update/restart', { method: 'POST', body: {} });
      result.append(h('div.hint', 'Restarting…'));
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await api('/api/status').catch(() => null);
        if (s?.version === version) { location.reload(); return; }
      }
      toast('The app did not come back; run `explainer restart`', 'error');
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  } }, 'Restart now');

  const install = (u) => h('button.btn.small.primary', { type: 'button', async onclick(e) {
    e.target.disabled = true;
    try {
      const job = await api('/api/update/install', { method: 'POST', body: { tag: u.tag } });
      result.append(jobView(job.id, { onEnd(j) {
        if (j.status !== 'succeeded') { e.target.disabled = false; return; }
        result.append(h('div.callout.info', `v${j.result.installed} is installed. Restart the app to use it.`,
          h('div.row', { style: { marginTop: '8px' } }, restart(j.result.installed), h('span.hint', 'or run ', h('code', 'explainer restart')))));
      } }).el);
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  } }, `Install v${u.latest}`);

  const check = h('button.btn.small', { type: 'button', async onclick() {
    check.disabled = true;
    result.replaceChildren(h('div.hint', 'Checking GitHub…'));
    try {
      const u = await api('/api/update');
      if (u.problem) result.replaceChildren(h('div.callout.warn', u.problem));
      else if (!u.newer) result.replaceChildren(h('div', `You're up to date: the latest release is v${u.latest}.`));
      else result.replaceChildren(h('div', `v${u.latest} is available. `, u.url ? h('a', { href: u.url, target: '_blank', rel: 'noopener' }, 'Release notes') : null),
        h('div.row', { style: { marginTop: '8px' } }, install(u)));
    } catch (err) {
      result.replaceChildren(h('div.callout.error', err.message));
    } finally { check.disabled = false; }
  } }, 'Check for update');

  return h('div.panel.version',
    h('h2', 'Version'),
    h('dl.kv', h('dt', 'Installed'), installed),
    h('div.row', { style: { marginTop: '10px' } }, check),
    result);
}
