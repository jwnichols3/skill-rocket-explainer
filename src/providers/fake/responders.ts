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
