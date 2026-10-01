import { h, toast } from '../dom.js';
import { api } from '../api.js';

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
}
