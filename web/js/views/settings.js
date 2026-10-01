import { h } from '../dom.js';
import { api } from '../api.js';

export async function settingsView(root) {
  const { settings } = await api('/api/settings');
  root.append(h('section.page',
    h('header.page-head', h('h1', 'Settings')),
    h('div.panel',
      h('h2', 'Providers'),
      h('dl.kv',
        h('dt', 'Agent surface'), h('dd', settings.providers.agent),
        h('dt', 'Voice provider'), h('dd', settings.providers.tts),
        h('dt', 'Video renderer'), h('dd', settings.providers.renderer.video)))));
}
