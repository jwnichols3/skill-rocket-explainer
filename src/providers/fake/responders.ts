import { designTemplate } from '../../style/design.ts';
import { responders } from './agent.ts';

/** Rewrites the Identity section to carry the description and every comment so tests can see them applied. */
function reviseDesign(current: string, description: string, comments: { text: string }[]): string {
  const base = current && /^---\n/.test(current) ? current : designTemplate(description);
  const notes = comments.map((c) => `- Applied: ${c.text}`).join('\n');
  const identity = `${description}${notes ? `\n\nRevisions:\n${notes}` : ''}`;
  return base.replace(/(^## Identity[^\n]*\n)[\s\S]*?(?=^## )/m, `$1\n${identity}\n\n`);
}

responders['style-sample'] = (inputs) => ({
  design: reviseDesign(inputs.currentDesign, inputs.description, [...(inputs.priorComments ?? []), ...(inputs.comments ?? [])]),
  scenes: [
    { id: 's1', title: 'Opening', narration: 'Every message you send starts a journey.', visuals: 'Title card slams in', elements: ['opening', 'text-popups'] },
    { id: 's2', title: 'Packets', narration: 'It splits into packets, each in its own box.', visuals: 'Boxes split apart', elements: ['boxes', 'transition'] },
    { id: 's3', title: 'Routers', narration: 'Routers pass them along a glowing map.', visuals: 'Network diagram lights up', elements: ['diagram', 'camera'] },
    { id: 's4', title: 'Arrival', narration: 'And they reassemble, just in time.', visuals: 'Pieces snap together', elements: ['transition', 'text-popups'] },
  ],
  summary: (inputs.comments ?? []).length ? `Applied ${(inputs.comments ?? []).length} comment(s).` : 'First pass from the description.',
});

responders['style-names'] = (inputs) => {
  const word = String(inputs.description ?? 'Style').split(/\W+/).find((w) => w.length > 3) ?? 'Style';
  const cap = word[0].toUpperCase() + word.slice(1).toLowerCase();
  return { names: [`${cap} Drive`, `Neon ${cap}`, `${cap} Express`] };
};

responders['probe'] = (inputs) => ({ answer: Number(inputs.a) + Number(inputs.b) });
responders['probe-escape'] = () => ({ tried: true });

import { palette } from '../../style/design.ts';

/** HyperFrames scene: a minimal valid composition (title animating in over the style's background), no model needed. */
responders['hyperframes-scene'] = (inputs) => {
  const colors = Object.fromEntries(palette(String(inputs.style ?? '')));
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const id = String(inputs.compositionId);
  const dur = Number(inputs.durationSeconds);
  return { __files: { 'index.html': `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=${inputs.width}, height=${inputs.height}" />
<script src="gsap.min.js"></script>
<style>
  body { margin: 0; background: ${colors.background ?? '#0b0f14'}; }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: linear-gradient(135deg, ${colors.background ?? '#0b0f14'}, ${colors.surface ?? '#141a22'}); }
  #${id}-title { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; font: 800 120px system-ui, sans-serif; color: ${colors.primary ?? '#4fd1c5'}; }
</style>
</head>
<body>
<div id="root" data-composition-id="${id}" data-start="0" data-width="${inputs.width}" data-height="${inputs.height}" data-duration="${dur}">
  <h1 id="${id}-title" class="clip" data-start="0" data-duration="${dur}" data-track-index="0">${esc(String(inputs.scene?.title ?? ''))}</h1>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#${id}-title", { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, 0.1);
  window.__timelines["${id}"] = tl;
</script>
</body>
</html>
` } };
};
