import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { navigate, registerRoute } from '../router.js';
import { getSettings } from '../components/pickers.js';

export function checksList(checks) {
  return h('div.checks', checks.map((c) => h('div.check', { class: c.ok ? 'ok' : c.optional ? 'warn' : 'missing' },
    h('span.badge', { class: c.ok ? 'ok' : c.optional ? 'warn' : 'danger' }, c.ok ? 'ok' : c.optional ? 'warn' : 'missing'),
    h('div', h('strong', c.label), h('div.muted.small', c.detail), !c.ok && c.fix ? h('div.small.fix', h('span.muted', 'Fix: '), c.fix) : null))));
}

/** First-run setup: where the app is reached, which surface, voice and renderer, and what is missing. */
async function setupView(root) {
  const [{ settings, checks, complete }, { available }] = await Promise.all([api('/api/setup'), api('/api/settings')]);
  const select = (id, items, value) => h('select', { id }, items.map((x) => h('option', { value: x.id, selected: x.id === value }, x.label)));
  const publicUrl = h('input', { id: 'setup-public-url', value: settings.publicUrl ?? '', placeholder: 'https://explainer.devbox.example (leave empty for this machine only)' });
  const agent = select('setup-agent', available.agent, settings.providers.agent);
  const tts = select('setup-tts', available.tts, settings.providers.tts);
  const video = select('setup-video', available.renderer.filter((r) => r.outputTypes.includes('video')), settings.providers.renderer.video);
  const checksBox = h('div', checksList(checks));
  const finish = h('button.btn.primary', { type: 'submit' }, complete ? 'Save' : 'Finish setup');

  root.append(h('section.page',
    h('header.page-head', h('div', h('h1', complete ? 'Setup' : 'Set up Rocket Explainer'), h('p.muted', { style: { margin: 0 } }, 'Safe to revisit; only what you change is saved.'))),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      finish.disabled = true;
      try {
        const r = await api('/api/setup', { method: 'POST', body: {
          publicUrl: publicUrl.value.trim(),
          providers: { agent: agent.value, tts: tts.value, renderer: { video: video.value } },
        } });
        await getSettings(true);
        checksBox.replaceChildren(checksList(r.checks));
        toast('Setup saved');
        navigate('/');
      } catch (err) { toast(err.message, 'error'); finish.disabled = false; }
    } },
    h('div.grid-2',
      h('div.stack',
        h('div.panel', h('h2', 'Where you reach it'),
          h('p.muted.small', `This app listens on ${location.origin.includes('127.0.0.1') || location.origin.includes('localhost') ? location.origin : '127.0.0.1'} only.`),
          h('div.field', h('label', { for: 'setup-public-url' }, 'Reverse-proxy URL'), publicUrl,
            h('div.hint', 'Running on a dev box? Put the address your browser uses here; it is added to the allowlist.'))),
        h('div.panel', h('h2', 'Providers'),
          h('div.field', h('label', { for: 'setup-agent' }, 'Agent surface'), agent, h('div.hint', 'Bedrock’s AWS profile and model mapping are in Settings > Models & agents.')),
          h('div.field', h('label', { for: 'setup-tts' }, 'Voice provider'), tts, h('div.hint', 'Polly’s AWS profile and voice API keys are in Settings > Voices.')),
          h('div.field', h('label', { for: 'setup-video' }, 'Video renderer'), video)),
        h('div.row.end', finish)),
      h('div.panel', h('div.panel-head', h('h2', 'Prerequisites'),
        h('button.btn.small', { type: 'button', onclick: async () => { checksBox.replaceChildren(checksList((await api('/api/setup')).checks)); } }, 'Re-check')),
        checksBox)))));
}

registerRoute(/^\/setup$/, setupView);
