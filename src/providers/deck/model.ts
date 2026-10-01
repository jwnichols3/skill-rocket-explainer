/**
 * The structured slide model a slide agent writes next to each slide's HTML (slides/<id>.json).
 * It is what makes the .pptx editable: every element becomes a native PowerPoint text box,
 * shape, line or table. Coordinates and sizes are CSS px on the 1920x1080 slide.
 * Colours and fonts may name style tokens ("primary", "display") or be literal values.
 */

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'middle' | 'bottom';

export interface TextStyle { font: string; size: number; color: string; bold: boolean; italic: boolean; align: Align; valign: VAlign }
export interface Box { x: number; y: number; w: number; h: number }

export type SlideElement =
  | ({ type: 'text'; text: string } & Box & TextStyle)
  | ({ type: 'bullets'; items: string[] } & Box & TextStyle)
  | ({ type: 'shape'; shape: ShapeKind; fill: string | null; line: string | null; lineWidth: number; radius: number; text: string } & Box & TextStyle)
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; arrow: 'none' | 'start' | 'end' | 'both'; dash: boolean }
  | ({ type: 'table'; rows: string[][]; colW?: number[]; header: boolean; fill: string | null; headerFill: string | null; headerColor: string; border: string | null } & Box & TextStyle)
  | ({ type: 'snapshot'; why: string } & Box);

export const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'hexagon', 'chevron', 'rightArrow'] as const;
export type ShapeKind = typeof SHAPES[number];

export interface SlideModel {
  /** Slide background colour, 6-digit hex without '#'. */
  background: string;
  elements: SlideElement[];
  notes?: string;
  /** True when the renderer substituted a full-slide picture for a missing/invalid model. */
  fallback?: boolean;
}

/** Resolved style tokens the model may reference by name. */
export interface Tokens { colors: Record<string, string>; fonts: Record<string, { family: string; bold: boolean }> }

export function tokensFrom(raw: Record<string, any>): Tokens {
  const colors: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw?.colors ?? {})) { const hex = hexOf(v); if (hex) colors[k] = hex; }
  const fonts: Record<string, { family: string; bold: boolean }> = {};
  for (const [k, v] of Object.entries(raw?.typography ?? {})) {
    const t = v as any;
    if (t && typeof t.family === 'string') fonts[k] = { family: t.family, bold: Number(t.weight) >= 600 };
  }
  return { colors, fonts };
}

function hexOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return h.toUpperCase();
}

/** Validates and normalizes a model. Returns the model, or the problems to feed back to the agent. */
export function parseSlideModel(raw: unknown, tokens: Tokens): { model: SlideModel; problems: [] } | { model: null; problems: string[] } {
  const problems: string[] = [];
  const at = (i: number, k: string) => `elements[${i}].${k}`;
  const color = (v: unknown, where: string, opts: { optional?: boolean; fallback?: string } = {}): string | null => {
    if (v === undefined || v === null || v === '') {
      if (opts.fallback !== undefined) return opts.fallback;
      if (opts.optional) return null;
      problems.push(`${where} is required`);
      return null;
    }
    if (opts.optional && (v === 'none' || v === 'transparent')) return null;
    const hex = typeof v === 'string' ? (tokens.colors[v] ?? hexOf(v)) : null;
    if (!hex) problems.push(`${where} "${String(v)}" is neither a colour token (${Object.keys(tokens.colors).join(', ')}) nor a #hex colour`);
    return hex;
  };
  const num = (v: unknown, where: string, min: number, max: number, fallback?: number): number => {
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) { problems.push(`${where} must be a number from ${min} to ${max}`); return fallback ?? min; }
    return v;
  };
  const str = (v: unknown, where: string, optional = false): string => {
    if (typeof v === 'string' && (optional || v.trim())) return v;
    if (v === undefined && optional) return '';
    problems.push(`${where} must be a non-empty string`);
    return '';
  };
  const box = (e: any, i: number): Box => ({
    x: num(e.x, at(i, 'x'), -SLIDE_W, 2 * SLIDE_W), y: num(e.y, at(i, 'y'), -SLIDE_H, 2 * SLIDE_H),
    w: num(e.w, at(i, 'w'), 1, 2 * SLIDE_W), h: num(e.h, at(i, 'h'), 1, 2 * SLIDE_H),
  });
  const textStyle = (e: any, i: number, defaults: Partial<TextStyle> = {}): TextStyle => {
    const fontKey = typeof e.font === 'string' && e.font.trim() ? e.font : (defaults.font ?? 'body');
    const font = tokens.fonts[fontKey];
    const align = e.align ?? defaults.align ?? 'left';
    const valign = e.valign ?? defaults.valign ?? 'top';
    if (!['left', 'center', 'right'].includes(align)) problems.push(`${at(i, 'align')} must be left, center or right`);
    if (!['top', 'middle', 'bottom'].includes(valign)) problems.push(`${at(i, 'valign')} must be top, middle or bottom`);
    return {
      font: font?.family ?? fontKey,
      size: num(e.size, at(i, 'size'), 6, 400, defaults.size ?? 32),
      color: color(e.color, at(i, 'color'), { fallback: tokens.colors.text ?? '000000' })!,
      bold: typeof e.bold === 'boolean' ? e.bold : (font?.bold ?? false),
      italic: e.italic === true,
      align, valign,
    };
  };

  const r = raw as any;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { model: null, problems: ['the slide model must be a JSON object'] };
  const background = color(r.background, 'background', { fallback: tokens.colors.background ?? 'FFFFFF' })!;
  if (!Array.isArray(r.elements) || !r.elements.length) problems.push('elements must be a non-empty array');
  const elements: SlideElement[] = [];
  for (const [i, e] of (Array.isArray(r.elements) ? r.elements : []).entries()) {
    if (!e || typeof e !== 'object') { problems.push(`elements[${i}] is not an object`); continue; }
    switch (e.type) {
      case 'text':
        elements.push({ type: 'text', text: str(e.text, at(i, 'text')), ...box(e, i), ...textStyle(e, i) });
        break;
      case 'bullets':
        if (!Array.isArray(e.items) || !e.items.length || e.items.some((x: unknown) => typeof x !== 'string')) problems.push(`${at(i, 'items')} must be a non-empty array of strings`);
        elements.push({ type: 'bullets', items: Array.isArray(e.items) ? e.items.map(String) : [], ...box(e, i), ...textStyle(e, i) });
        break;
      case 'shape': {
        const shape = e.shape ?? 'rect';
        if (!(SHAPES as readonly string[]).includes(shape)) problems.push(`${at(i, 'shape')} must be one of ${SHAPES.join(', ')}`);
        elements.push({
          type: 'shape', shape, ...box(e, i), fill: color(e.fill, at(i, 'fill'), { optional: true }), line: color(e.line, at(i, 'line'), { optional: true }),
          lineWidth: num(e.lineWidth, at(i, 'lineWidth'), 0, 64, 2), radius: num(e.radius, at(i, 'radius'), 0, SLIDE_H, 0),
          text: str(e.text, at(i, 'text'), true), ...textStyle(e, i, { align: 'center', valign: 'middle' }),
        });
        break;
      }
      case 'line': {
        const arrow = e.arrow ?? 'none';
        if (!['none', 'start', 'end', 'both'].includes(arrow)) problems.push(`${at(i, 'arrow')} must be none, start, end or both`);
        elements.push({
          type: 'line', x1: num(e.x1, at(i, 'x1'), -SLIDE_W, 2 * SLIDE_W), y1: num(e.y1, at(i, 'y1'), -SLIDE_H, 2 * SLIDE_H),
          x2: num(e.x2, at(i, 'x2'), -SLIDE_W, 2 * SLIDE_W), y2: num(e.y2, at(i, 'y2'), -SLIDE_H, 2 * SLIDE_H),
          color: color(e.color, at(i, 'color'), { fallback: tokens.colors.text ?? '000000' })!, width: num(e.width, at(i, 'width'), 0.5, 64, 3), arrow, dash: e.dash === true,
        });
        break;
      }
      case 'table': {
        const ok = Array.isArray(e.rows) && e.rows.length && e.rows.every((row: unknown) => Array.isArray(row) && row.length && row.every((c) => typeof c === 'string'));
        if (!ok) problems.push(`${at(i, 'rows')} must be a non-empty array of non-empty arrays of strings`);
        const cols = ok ? Math.max(...e.rows.map((row: string[]) => row.length)) : 0;
        const colW = e.colW;
        if (colW !== undefined && (!Array.isArray(colW) || colW.length !== cols || colW.some((w: unknown) => typeof w !== 'number' || !(w > 0)))) problems.push(`${at(i, 'colW')} must list ${cols} positive column widths in px`);
        elements.push({
          type: 'table', rows: ok ? e.rows : [], ...(colW !== undefined ? { colW } : {}), header: e.header !== false, ...box(e, i), ...textStyle(e, i, { size: 28 }),
          fill: color(e.fill, at(i, 'fill'), { optional: true }), headerFill: color(e.headerFill, at(i, 'headerFill'), { optional: true }),
          headerColor: color(e.headerColor, at(i, 'headerColor'), { fallback: tokens.colors.text ?? '000000' })!, border: color(e.border, at(i, 'border'), { optional: true }),
        });
        break;
      }
      case 'snapshot':
        elements.push({ type: 'snapshot', why: str(e.why, at(i, 'why')), ...box(e, i) });
        break;
      default:
        problems.push(`elements[${i}].type "${e.type}" is not one of text, bullets, shape, line, table, snapshot`);
    }
  }
  if (r.notes !== undefined && typeof r.notes !== 'string') problems.push('notes must be a string');
  if (problems.length) return { model: null, problems };
  return { model: { background, elements, ...(typeof r.notes === 'string' && r.notes.trim() ? { notes: r.notes } : {}), ...(r.fallback === true ? { fallback: true } : {}) }, problems: [] };
}

/** A whole-slide picture, used when the agent could not produce a valid model. */
export function fallbackModel(background: string): SlideModel {
  return { background, elements: [{ type: 'snapshot', why: 'no valid slide model', x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }], fallback: true };
}
