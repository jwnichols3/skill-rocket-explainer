import { readFile, writeFile } from 'node:fs/promises';
import pptxgenjs from 'pptxgenjs';
import { SLIDE_W, type SlideModel, type TextStyle, type Box } from './model.ts';

// At runtime the ESM build's default export is the class; its CJS-style typings model it as `.default`.
const PptxGenJS = pptxgenjs as unknown as typeof pptxgenjs.default;

/** px on the 1920x1080 slide -> inches on the 13.333x7.5 in (16:9) PowerPoint slide. */
const PX_PER_IN = SLIDE_W / 13.333;
const inch = (px: number) => px / PX_PER_IN;
/** CSS px -> points at that scale (1920 px = 960 pt). */
const pt = (px: number) => Math.round(px * (72 / PX_PER_IN) * 10) / 10;

export interface PptxSlide {
  model: SlideModel;
  /** PNG file per snapshot element, in element order. */
  snapshots: string[];
  /** Speaker notes when the model has none (the slide's body text). */
  notes: string;
}

const box = (b: Box) => ({ x: inch(b.x), y: inch(b.y), w: inch(b.w), h: inch(b.h) });
const text = (t: TextStyle) => ({
  fontFace: t.font, fontSize: pt(t.size), color: t.color, bold: t.bold, italic: t.italic,
  align: t.align, valign: t.valign, margin: 0,
});

/** Builds an editable .pptx: native text boxes, shapes, lines and tables; pictures only for snapshot elements. */
export async function writePptx(file: string, deck: { title: string; slides: PptxSlide[] }): Promise<void> {
  const pres = new PptxGenJS();
  pres.layout = 'LAYOUT_WIDE';
  pres.title = deck.title;
  for (const s of deck.slides) {
    const slide = pres.addSlide();
    slide.background = { color: s.model.background };
    let snap = 0;
    for (const e of s.model.elements) {
      switch (e.type) {
        case 'text':
          slide.addText(e.text, { ...box(e), ...text(e), fit: 'shrink' });
          break;
        case 'bullets':
          slide.addText(e.items.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { ...box(e), ...text(e), paraSpaceAfter: pt(e.size * 0.4), fit: 'shrink' });
          break;
        case 'shape': {
          const opts = {
            ...box(e),
            shape: pres.ShapeType[e.shape],
            fill: e.fill ? { color: e.fill } : { type: 'none' as const },
            line: e.line && e.lineWidth > 0 ? { color: e.line, width: pt(e.lineWidth) } : { type: 'none' as const },
            ...(e.shape === 'roundRect' ? { rectRadius: inch(Math.min(e.radius, e.w / 2, e.h / 2)) } : {}),
          };
          if (e.text) slide.addText(e.text, { ...opts, ...text(e) });
          else slide.addShape(pres.ShapeType[e.shape], opts);
          break;
        }
        case 'line':
          slide.addShape(pres.ShapeType.line, {
            x: inch(Math.min(e.x1, e.x2)), y: inch(Math.min(e.y1, e.y2)), w: inch(Math.abs(e.x2 - e.x1)), h: inch(Math.abs(e.y2 - e.y1)),
            flipH: e.x2 < e.x1, flipV: e.y2 < e.y1,
            line: {
              color: e.color, width: pt(e.width), dashType: e.dash ? 'dash' : 'solid',
              beginArrowType: e.arrow === 'start' || e.arrow === 'both' ? 'triangle' : 'none',
              endArrowType: e.arrow === 'end' || e.arrow === 'both' ? 'triangle' : 'none',
            },
          });
          break;
        case 'table': {
          const cols = Math.max(...e.rows.map((r) => r.length));
          const rows = e.rows.map((r, ri) => Array.from({ length: cols }, (_, ci) => {
            const head = e.header && ri === 0;
            return { text: r[ci] ?? '', options: { bold: head || e.bold, color: head ? e.headerColor : e.color, ...(head && e.headerFill ? { fill: { color: e.headerFill } } : e.fill ? { fill: { color: e.fill } } : {}) } };
          }));
          slide.addTable(rows, {
            ...box(e), colW: e.colW ? e.colW.map(inch) : Array(cols).fill(inch(e.w) / cols), fontFace: e.font, fontSize: pt(e.size), align: e.align, valign: e.valign,
            border: e.border ? { type: 'solid', color: e.border, pt: 1 } : { type: 'none' },
          });
          break;
        }
        case 'snapshot': {
          const png = s.snapshots[snap++];
          if (png) slide.addImage({ data: `image/png;base64,${(await readFile(png)).toString('base64')}`, ...box(e), altText: e.why });
          break;
        }
      }
    }
    const notes = s.model.notes ?? s.notes;
    if (notes) slide.addNotes(notes);
  }
  const buf = await pres.write({ outputType: 'nodebuffer' }) as Uint8Array;
  await writeFile(file, buf);
}

