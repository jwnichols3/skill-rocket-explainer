import { clear, h } from './dom.js';
import { homeView } from './views/home.js';
import { explainersView } from './views/explainers.js';
import { stylesView } from './views/styles.js';
import { settingsView } from './views/settings.js';
import { newExplainerView } from './views/new-explainer.js';

/** Routes: [pattern, view]. A view gets (root, params) and may return a cleanup function. */
const routes = [
  [/^\/$/, homeView],
  [/^\/new$/, newExplainerView],
  [/^\/explainers$/, explainersView],
  [/^\/styles$/, stylesView],
  [/^\/settings$/, settingsView],
];

export function registerRoute(re, view) { routes.unshift([re, view]); }

let cleanup = null;

export async function render() {
  const root = document.getElementById('view');
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  clear(root);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  for (const a of document.querySelectorAll('.topnav a')) {
    a.classList.toggle('active', path === a.getAttribute('href') || path.startsWith(a.getAttribute('href') + '/'));
  }
  for (const [re, view] of routes) {
    const m = re.exec(path);
    if (m) {
      try { cleanup = await view(root, m.groups ?? {}); }
      catch (err) { root.append(h('section.page', h('div.callout.error', h('strong', 'Something went wrong. '), String(err.message ?? err)))); }
      return;
    }
  }
  root.append(h('section.page', h('h1', 'Not found'), h('p', h('a', { href: '/', 'data-link': true }, 'Back home'))));
}

export function navigate(path) {
  history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
});
window.addEventListener('popstate', render);
render();
