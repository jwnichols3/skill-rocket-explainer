import { designTemplate, palette } from '../../style/design.ts';
import { responders } from './agent.ts';

/** Appends each comment to the Identity section (and the description on round one) so tests can see them applied. */
function reviseDesign(current: string, description: string, comments: { text: string }[]): string {
  const base = current && /^---\n/.test(current) ? current : designTemplate(description);
  const additions = [base.includes(description) ? '' : description, ...comments.map((c) => `- Applied: ${c.text}`)].filter(Boolean).join('\n');
  if (!additions) return base;
  return base.replace(/(^## Identity[^\n]*\n[\s\S]*?)(?=^## )/m, `$1${additions}\n\n`);
}

responders['style-sample'] = (inputs) => ({
  design: reviseDesign(inputs.currentDesign, inputs.description, inputs.comments ?? []),
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

responders['source-report'] = async (inputs) => {
  const { access } = await import('node:fs/promises');
  const sources = [];
  for (const s of inputs.sources ?? []) {
    let found = true;
    if (s.kind === 'path') found = await access(s.value).then(() => true, () => false);
    if (s.kind === 'url') found = !/missing|404/.test(s.value);
    sources.push(found
      ? { sourceId: s.id, found, summary: `Fake summary of ${s.value}.`, extract: `- Key point from ${s.value}` }
      : { sourceId: s.id, found, summary: '', extract: '', notes: 'Could not be reached.' });
  }
  const corrections = (inputs.corrections ?? []).map((c: string) => `Correction applied: ${c}.`).join(' ');
  return { suggestedTitle: 'Fake explainer', overall: `Covers ${sources.filter((s) => s.found).length} source(s) for "${inputs.brief}". ${corrections}`.trim(), sources, gaps: ['No cost numbers.'] };
};

responders['explainer-plan'] = (inputs) => {
  const comments: string[] = inputs.comments ?? [];
  const unit = inputs.outputType === 'deck' ? 'Slide' : inputs.outputType === 'doc' ? 'Section' : inputs.outputType === 'visual' ? 'Panel' : 'Scene';
  return {
    title: 'Fake explainer',
    summary: `A short ${inputs.outputType} about ${inputs.brief}.${comments.length ? ` Revised: ${comments.join('; ')}.` : ''}`,
    length: inputs.outputType === 'video' ? '~12 s' : '3 units',
    outline: ['Set up the question', 'Compare the options', 'Land the recommendation'],
    scenes: [
      { id: 's1', title: `${unit} one`, purpose: 'Hook', narration: 'Two options, one decision.', visuals: 'Title card' },
      { id: 's2', title: `${unit} two`, purpose: 'Compare', narration: 'Queues buffer work; streams replay it.', visuals: 'Side-by-side boxes' },
      { id: 's3', title: `${unit} three`, purpose: 'Land it', narration: 'Pick the one that fits your load.', visuals: 'Highlighted winner' },
    ],
    keyVisuals: ['Side-by-side comparison', ...comments.map((c) => `Per comment: ${c}`)],
  };
};

responders['explainer-script'] = (inputs) => ({
  scenes: (inputs.plan?.scenes ?? []).map((s: any) => ({ id: s.id, title: s.title, narration: s.narration || `${s.title}.`, visuals: s.visuals })),
});

responders['explainer-revise'] = (inputs) => ({
  scenes: (inputs.script ?? []).filter((s: any) => (inputs.dirty ?? []).includes(s.id)).map((s: any) => {
    const notes = (inputs.comments ?? []).filter((c: any) => c.sceneId === s.id || c.sceneId === null).map((c: any) => c.text);
    return { ...s, visuals: `${s.visuals} [revised: ${notes.join('; ')}]` };
  }),
});
/** A small valid Remotion scene (title fading up over the style's background) so the Remotion renderer runs without a model. */
const FAKE_REMOTION_SCENE = `import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneProps } from '../types';

export default function Scene({ scene, style }: SceneProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const colors = style.colors ?? {};
  const enter = interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ backgroundColor: colors.background ?? '#000', justifyContent: 'center', alignItems: 'center', fontFamily: 'sans-serif' }}>
      <div style={{ opacity: enter, transform: \`translateY(\${(1 - enter) * 40}px)\`, color: colors.text ?? '#fff', fontSize: 120, fontWeight: 800 }}>{scene.title}</div>
      <div style={{ position: 'absolute', left: 0, bottom: 0, height: 12, width: \`\${(frame / durationInFrames) * 100}%\`, backgroundColor: colors.primary ?? '#4fd1c5' }} />
    </AbsoluteFill>
  );
}
`;

// Scenes whose visuals contain "[fake: broken once]" get code that fails to compile on the first attempt (tests the retry).
responders['remotion-scene'] = (inputs) => {
  const broken = String(inputs.scene?.visuals ?? '').includes('[fake: broken once]') && !inputs.previousError;
  return { __files: { [inputs.file]: broken ? 'export default function Scene( {\n' : FAKE_REMOTION_SCENE } };
};

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
