import { designTemplate } from '../../style/design.ts';
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
