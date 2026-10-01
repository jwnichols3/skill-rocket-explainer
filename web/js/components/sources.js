import { h } from '../dom.js';
import { api } from '../api.js';

export const KINDS = [
  { id: 'path', label: 'File or folder' },
  { id: 'url', label: 'Link' },
  { id: 'connector', label: 'Connector' },
  { id: 'note', label: 'Note' },
];

export function guessKind(v) {
  if (/^https?:\/\//i.test(v)) return 'url';
  if (/^(~|\/|\.\.?\/)/.test(v)) return 'path';
  return null;
}

let datalist = null;
/** One shared <datalist> fed by server-side path completion. */
export function pathSuggestions() {
  if (!datalist) datalist = h('datalist', { id: 'source-suggestions' });
  return datalist;
}

/** Wire path completion onto an input. */
export function attachPathCompletion(input) {
  input.setAttribute('list', 'source-suggestions');
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value;
    if (!/^(~|\/|\.\.?\/)/.test(v)) return;
    timer = setTimeout(async () => {
      const items = await api(`/api/fs/complete?prefix=${encodeURIComponent(v)}`).catch(() => []);
      pathSuggestions().replaceChildren(...items.map((i) => h('option', { value: i.dir ? i.path + '/' : i.path })));
    }, 120);
  });
}

export const kindLabel = (k) => KINDS.find((x) => x.id === k)?.label ?? k;
