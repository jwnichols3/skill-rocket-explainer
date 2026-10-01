import { h, toast } from '../dom.js';
import { api } from '../api.js';

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-m4v';

/** Sends the file's bytes as the request body (works when the browser is on another machine). */
export async function uploadReference(styleId, file) {
  const res = await fetch(`/api/styles/${styleId}/references?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'x-explainer': '1', 'content-type': file.type || 'application/octet-stream' }, body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

export const analyzeReference = (styleId, refId) => api(`/api/styles/${styleId}/references/${refId}/analyze`, { method: 'POST', body: {} });

function fileInput(id, accept, multiple, onFiles) {
  const input = h('input', { type: 'file', id, accept, multiple, onchange: () => { const files = [...input.files]; input.value = ''; if (files.length) onFiles(files); } });
  return input;
}

function linkFields(onAdd) {
  const url = h('input', { id: 'ref-link', type: 'url', placeholder: 'https://…' });
  const note = h('input', { id: 'ref-link-note', placeholder: 'What to take from it, e.g. “the title cards”' });
  const add = h('button.btn.small', { type: 'button', onclick: async () => {
    if (!/^https?:\/\//i.test(url.value.trim())) { toast('Links must start with http:// or https://', 'error'); url.focus(); return; }
    add.disabled = true;
    try { await onAdd(url.value.trim(), note.value.trim()); url.value = ''; note.value = ''; } catch (err) { toast(err.message, 'error'); }
    add.disabled = false;
  } }, 'Add link');
  return h('div',
    h('div.field', h('label', { for: 'ref-link' }, 'Reference link'), url),
    h('div.field', h('label', { for: 'ref-link-note' }, 'Link note'), note),
    h('div.row.end', add));
}

const thumb = (src, alt) => h('img', { src, alt, loading: 'lazy', style: { width: '96px', height: '54px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' } });
const removeBtn = (label, onclick) => h('button.btn.ghost.small', { type: 'button', 'aria-label': label, onclick }, '✕');

/**
 * References gathered on the new-style form before the style exists. attach(styleId) uploads
 * them and returns the reference video (if any) so the caller can start its analysis.
 */
export function pendingReferences({ onChange } = {}) {
  const items = [];
  const list = h('div.stack.ref-list');
  const changed = () => {
    list.replaceChildren(...items.map((it, i) => h('div.row.ref', { 'data-kind': it.kind },
      h('span.badge', it.kind), h('span.grow', { style: { flex: 1, overflowWrap: 'anywhere' } }, it.file?.name ?? it.url, it.note ? h('span.muted.small', ` · ${it.note}`) : null),
      removeBtn(`Remove ${it.file?.name ?? it.url}`, () => { items.splice(i, 1); changed(); }))));
    onChange?.();
  };
  const images = fileInput('ref-image', IMAGE_ACCEPT, true, (files) => { for (const file of files) items.push({ kind: 'image', file }); changed(); });
  const video = fileInput('ref-video', VIDEO_ACCEPT, false, ([file]) => {
    const at = items.findIndex((x) => x.kind === 'video');
    if (at >= 0) items.splice(at, 1);
    items.push({ kind: 'video', file });
    changed();
  });
  const el = h('div.panel',
    h('h2', 'References'),
    h('p.muted.small', 'Optional. Images and links inform the first sample. A reference video is sampled into frames and turned into style instructions you can review before the first sample.'),
    h('div.field', h('label', { for: 'ref-image' }, 'Add reference image'), images),
    h('div.field', h('label', { for: 'ref-video' }, 'Add reference video'), video),
    linkFields(async (url, note) => { items.push({ kind: 'link', url, note }); changed(); }),
    list);
  return {
    el,
    hasVideo: () => items.some((x) => x.kind === 'video'),
    async attach(styleId) {
      let videoRef = null;
      for (const it of items) {
        const ref = it.kind === 'link'
          ? await api(`/api/styles/${styleId}/references`, { method: 'POST', body: { url: it.url, note: it.note || undefined } })
          : await uploadReference(styleId, it.file);
        if (ref.kind === 'video') videoRef = ref;
      }
      return { video: videoRef };
    },
  };
}

/** The style page's references: list, add, remove, analyze a video. */
export function referencesPanel(style, { busy, onChange }) {
  const run = (fn) => async () => { try { await fn(); await onChange(); } catch (err) { toast(err.message, 'error'); } };
  const remove = (r) => run(() => api(`/api/styles/${style.id}/references/${r.id}`, { method: 'DELETE' }));
  const items = style.references.map((r) => h('div.ref', { 'data-kind': r.kind, style: { borderTop: '1px solid var(--border)', paddingTop: '10px' } },
    h('div.row',
      r.kind === 'image' ? thumb(r.fileUrl, r.name) : h('span.badge', r.kind),
      r.kind === 'link'
        ? h('span', { style: { flex: 1, overflowWrap: 'anywhere' } }, h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url), r.note ? h('div.muted.small', r.note) : null)
        : h('span', { style: { flex: 1, overflowWrap: 'anywhere' } }, r.name),
      r.kind === 'video' && r.fileUrl ? h('button.btn.small', { type: 'button', disabled: busy, onclick: run(() => analyzeReference(style.id, r.id)) }, r.analyzedAt ? 'Analyze again' : 'Analyze') : null,
      busy ? null : removeBtn(`Remove ${r.name}`, remove(r))),
    r.frameUrls?.length ? h('div.ref-frames', { style: { display: 'flex', gap: '4px', overflowX: 'auto', marginTop: '8px' } }, r.frameUrls.map((u, i) => thumb(u, `Frame at ${(r.frames[i].atMs / 1000).toFixed(1)} s`))) : null,
    r.instructions ? h('pre.small.ref-instructions', { style: { whiteSpace: 'pre-wrap', marginTop: '8px' } }, r.instructions) : null));

  const images = fileInput('ref-image', IMAGE_ACCEPT, true, (files) => run(async () => { for (const f of files) await uploadReference(style.id, f); })());
  const video = fileInput('ref-video', VIDEO_ACCEPT, false, ([file]) => run(async () => {
    toast('Uploading the reference video…');
    const ref = await uploadReference(style.id, file);
    await analyzeReference(style.id, ref.id);
  })());
  images.disabled = video.disabled = !!busy;
  return h('div.panel.references',
    h('h3', 'References'),
    items.length ? h('div.stack', items) : h('p.muted.small', 'No references. Images and links inform the next sample; a video becomes style instructions.'),
    h('details', { style: { marginTop: '12px' }, open: !items.length },
      h('summary.small', 'Add references'),
      h('div.field', h('label', { for: 'ref-image' }, 'Add reference image'), images),
      h('div.field', h('label', { for: 'ref-video' }, 'Add reference video'), video, h('div.hint', 'Uploaded, then sampled into frames and turned into style instructions.')),
      linkFields((url, note) => run(() => api(`/api/styles/${style.id}/references`, { method: 'POST', body: { url, note: note || undefined } }))())));
}

/** "Suggest improvements" for a style description: each suggestion inserts with one click. */
export function suggestionBox(textarea, getModel = () => ({})) {
  const list = h('div.suggestions.stack', { style: { marginTop: '8px' } });
  const btn = h('button.btn.small', { type: 'button', onclick: async () => {
    if (!textarea.value.trim()) { toast('Write a first description, then ask for suggestions', 'error'); textarea.focus(); return; }
    btn.disabled = true;
    btn.replaceChildren(h('span.spinner'), 'Thinking…');
    try {
      const { suggestions } = await api('/api/styles/suggest', { method: 'POST', body: { description: textarea.value, ...getModel() } });
      list.replaceChildren(...suggestions.map((s) => {
        const row = h('div.row.suggestion', { style: { alignItems: 'flex-start' } },
          h('span.badge', s.topic), h('span', { style: { flex: 1 } }, s.text),
          h('button.btn.small', { type: 'button', 'aria-label': `Insert: ${s.text}`, onclick: () => {
            const cur = textarea.value.trimEnd();
            textarea.value = cur ? `${cur}\n${s.text}` : s.text;
            textarea.dispatchEvent(new Event('input'));
            row.remove();
          } }, 'Insert'));
        return row;
      }));
    } catch (err) { toast(err.message, 'error'); }
    btn.disabled = false;
    btn.replaceChildren('Suggest improvements');
  } }, 'Suggest improvements');
  return h('div', { style: { marginTop: '8px' } }, btn, list);
}
