import { clear, h } from './dom.js';

/** Routes: [regex, view]. A view gets (root, params) and may return a cleanup function. */
const routes = [];
export function registerRoute(re, view) { routes.push([re, view]); }

let cleanup = null;

export async function render() {
  const root = document.getElementById('view');
  if (typeof cleanup === 'function') { try { cleanup(); } catch {} }
  cleanup = null;
  clear(root);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  for (const a of document.querySelectorAll('.topnav a')) {
    const href = a.getAttribute('href');
    a.classList.toggle('active', path === href || path.startsWith(href + '/'));
  }
  for (const [re, view] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    try { cleanup = await view(root, m.groups ?? {}); }
    catch (err) { root.append(h('section.page', h('div.callout.error', h('strong', 'Something went wrong. '), String(err.message ?? err)))); }
    return;
  }
  root.append(h('section.page', h('h1', 'Not found'), h('p', h('a', { href: '/', 'data-link': true }, 'Back home'))));
}

export function navigate(path) {
  history.pushState({}, '', path);
  render();
  window.scrollTo(0, 0);
}

export function startRouter() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', render);
  render();
}
