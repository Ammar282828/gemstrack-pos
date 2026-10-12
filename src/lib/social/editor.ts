/**
 * The story as a document of layers, so every part of it can be moved.
 *
 * A story is a background (one of the photos, placed and zoomed, with an
 * optional dim or gradient for legibility) and a stack of layers over it:
 * text, the wordmark, arrows and shapes like the hand-drawn ones in the shop's
 * stories, and photo insets. Every layer has a position and size in story
 * pixels (1080 × 1920) and is drawn, measured and hit-tested here, so the
 * preview, the dragging and the exported JPEG all agree to the pixel.
 *
 * Text layers can be bound to the piece's fields (kicker, headline, weight,
 * details): typing the headline in the form changes it on the story wherever
 * it has been dragged to. Presets lay the bound layers out the way the shop's
 * stories do (left stack, centred, split, bottom); after that everything is
 * free.
 */

import { STORY_FRAME, drawStoryPhoto, type Frame, type Placement } from './story';
import type { Palette } from './palettes';
import { SHAPES, applyAdjust, changesPixels, type Adjust, type MaskKey, type ShapeKey } from './design';
import { colorWithAlpha, makeGradient } from './gradient';
import { qrFor } from './qr';

export type FontKey =
  | 'condensed' | 'light' | 'regular' | 'bold' | 'serif' | 'serif-italic' | 'futura'
  | 'cormorant' | 'cormorant-italic' | 'playfair' | 'script' | 'montserrat' | 'montserrat-bold' | 'cinzel'
  // Designer v2's jewellery set (2026-10-12).
  | 'cormorant-infant' | 'italiana' | 'jost' | 'tenor' | 'dm-serif' | 'marcellus';
export type Bind = 'kicker' | 'headline' | 'weight' | 'details';

/**
 * Designer v2 (docs/features/design-studio-plan.md §2.5): every field below is optional and missing means
 * today's behaviour, so a document saved before it draws exactly as it did (render-golden.test.ts holds the
 * draw calls); the iPhone app's bundled engine keeps unknown fields as they are.
 */
export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'hard-light' | 'color-dodge' | 'darken' | 'lighten';
/** What a layer is for, so a resize can lay it out by its job (plan §3). */
export type LayerRole = 'photo' | 'headline' | 'kicker' | 'specs' | 'cta' | 'mark' | 'badge' | 'frame' | 'band' | 'decor' | 'text' | 'image';
export interface LayerFx {
  shadow?: { color: string; x: number; y: number; blur: number; alpha: number };
  glow?: { color: string; blur: number; alpha: number };
  outline?: { color: string; width: number };
}
export interface Gradient { type: 'linear' | 'radial'; angle: number; stops: { at: number; color: string; alpha?: number }[] }
/** A style over characters `from`…`to` of a text layer's words (size is a multiple of the layer's). */
export interface TextRun { from: number; to: number; font?: FontKey; color?: string; size?: number; upper?: boolean; underline?: boolean; gradient?: Gradient }
/** A box as fractions (0…1) of the frame. */
export interface Box01 { x: number; y: number; w: number; h: number }

interface Base {
  id: string; rotate: number; opacity: number; hidden?: boolean;
  /** Can't be moved, sized or deleted until unlocked (Canva's lock). */
  locked?: boolean;
  /** Mirrored (images, shapes and marks). */
  flipX?: boolean; flipY?: boolean;
  /** The counter's own name for it in the layers list. */
  name?: string;
  /** Layers sharing a group id select and move as one. */
  group?: string;
  /** How the layer mixes with what is under it (canvas composite operation); missing = normal. */
  blend?: Blend;
  role?: LayerRole;
  /** Shadow, glow and outline for shapes, images, marks and QR codes (named `layerFx` because an image's `fx` is its crop's x). Text keeps its own `effect`. */
  layerFx?: LayerFx;
}

/** Canva's text effects. Numbers are 0…100; `angle` is degrees clockwise from the right. */
export type EffectKind = 'shadow' | 'lift' | 'hollow' | 'outline' | 'splice' | 'echo' | 'neon' | 'glitch';
export interface TextEffect { kind: EffectKind; color: string; offset: number; angle: number; blur: number; thickness: number; transparency: number }
export const EFFECTS: { kind: EffectKind | 'none'; label: string }[] = [
  { kind: 'none', label: 'None' }, { kind: 'shadow', label: 'Shadow' }, { kind: 'lift', label: 'Lift' }, { kind: 'hollow', label: 'Hollow' },
  { kind: 'outline', label: 'Outline' }, { kind: 'splice', label: 'Splice' }, { kind: 'echo', label: 'Echo' }, { kind: 'neon', label: 'Neon' }, { kind: 'glitch', label: 'Glitch' },
];
export function effectDefaults(kind: EffectKind, text: string): TextEffect {
  const base = { color: '#000000', offset: 30, angle: 45, blur: 20, thickness: 40, transparency: 50 };
  switch (kind) {
    case 'shadow': return { kind, ...base };
    case 'lift': return { kind, ...base, transparency: 40 };
    case 'hollow': return { kind, ...base, thickness: 35 };
    case 'outline': return { kind, ...base, color: text.toLowerCase() === '#000000' || text.toLowerCase() === '#111111' ? '#FFFFFF' : '#111111', thickness: 45 };
    case 'splice': return { kind, ...base, color: '#C9973F', offset: 40, thickness: 35 };
    case 'echo': return { kind, ...base, color: text, offset: 35 };
    case 'neon': return { kind, ...base, color: text, blur: 50 };
    case 'glitch': return { kind, ...base, offset: 30 };
  }
}
export interface TextLayer extends Base {
  kind: 'text';
  /** When set, the text comes from the piece's field of that name. */
  bind?: Bind;
  text: string;
  /** Anchor: the left, centre or right edge (by `align`) of the text, and its top. */
  x: number; y: number;
  size: number;
  font: FontKey;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Longest a line may be before it wraps (and, with `fit`, before it shrinks). */
  width: number;
  /** Shrink to fit `width` — and break into two balanced lines if it would get too small. */
  fit: boolean;
  spacing: number;     // letter spacing, em
  lineHeight: number;  // × size
  upper: boolean;
  shadow: boolean;
  box: { color: string; radius: number; pad: number } | null;
  /**
   * Part of a preset's stack: its top follows the layer above it (plus `gap`)
   * as the words change length, so a headline that grows to two lines pushes
   * the weight and details down instead of running into them. Dragging the
   * layer takes it out of the stack and leaves it where it was put.
   */
  flow?: { gap: number };
  /** Pick white or near-black for whatever is behind it, per photo (the overlay tool's two variants). */
  autoColor?: boolean;
  /** Replaces `shadow` when set. */
  effect?: TextEffect | null;
  /** Bend the words along an arc: + arches up, − smiles; −100…100. One line when bent. */
  curve?: number;
  underline?: boolean;
  /**
   * Designer v2: mixed styles in one box (runs index the words as written, before `upper`), bullets or numbers
   * (one per line break), a gradient fill over the whole text. Ignored by bent (`curve`) text.
   */
  runs?: TextRun[];
  list?: 'bullet' | 'number' | null;
  fillGradient?: Gradient | null;
}
/**
 * The shop's mark, from its SVG: the "taheri" wordmark or the "t" monogram.
 * Drawn in any colour (the SVG's shape filled with `color`), or white /
 * near-black by what is under it when `autoColor` is on.
 */
export type MarkKind = 'wordmark' | 't';
export interface MarkLayer extends Base { kind: 'wordmark'; mark: MarkKind; x: number; y: number; width: number; color: string; autoColor: boolean }
export interface ShapeLayer extends Base {
  kind: 'arrow' | 'line' | 'rect' | 'circle' | 'shape';
  /** For arrow/line: from (x, y) to (x + w, y + h). For rect/circle/shape: the box. */
  x: number; y: number; w: number; h: number;
  color: string; stroke: number;
  fill: string | null;
  /** A second fill colour: the fill runs from `fill` to this, top to bottom. */
  fill2?: string | null;
  /** Arrows and lines bow by this much (px, perpendicular), like a hand-drawn stroke. */
  curve: number;
  radius: number;
  /** Which outline a `shape` is (design.ts). */
  shape?: ShapeKey;
  dash?: 'solid' | 'dash' | 'dot';
  /** Designer v2: replaces the two-colour fill (and fills a shape that has no `fill`). */
  fillGradient?: Gradient | null;
}
/**
 * Designer v2: a QR code for `value`, `w` wide (and as tall) including `quiet` empty modules all round (0…8,
 * 4 is the standard's); `bg` fills the square (null leaves the quiet zone clear). Too long or empty a value draws nothing.
 */
export interface QrLayer extends Base { kind: 'qr'; x: number; y: number; w: number; value: string; fg: string; bg: string | null; quiet: number }
export interface ImageLayer extends Base {
  kind: 'image';
  /** One of the piece's photos… */
  photoId: string;
  /** …or an image the counter uploaded (a data URL, so saved layouts carry it). */
  src?: string;
  x: number; y: number; w: number;
  /** A frame's own height: the photo fills w × h, cropped. Unset keeps the photo's proportions. */
  h?: number;
  /** Where the crop sits when framed, 0…1 (centre by default). */
  fx?: number; fy?: number;
  /** How far the photo is zoomed inside its frame, 1 = just covering it (up to 4). */
  iz?: number;
  radius: number; border: string | null; shadow: boolean;
  /** Cut to a shape (a Canva frame). */
  mask?: MaskKey | null;
  adjust?: Adjust | null;
  /** A gradient over the picture, inside its frame. */
  shade?: Shade | null;
  /** Designer v2: a PNG with alpha from the background remover — drawn without the frame's fill or border, its shadow following its outline. */
  cutout?: boolean;
}
export type Layer = TextLayer | MarkLayer | ShapeLayer | ImageLayer | QrLayer;

/**
 * A gradient laid over a photo (the background or a picture), every part adjustable: two colours, each
 * with its own opacity, the direction (CSS degrees: 180 runs top to bottom) and where along it the fade
 * starts and ends (0…1).
 */
export interface Shade { from: string; fromAlpha: number; to: string; toAlpha: number; angle: number; start: number; end: number }
export const SHADE_DEFAULT: Shade = { from: '#000000', fromAlpha: 0, to: '#000000', toAlpha: 0.7, angle: 180, start: 0.4, end: 1 };

export interface StoryDoc {
  bg: {
    photoId: string | null; placement: Placement; dim: number; gradient: 'none' | 'top' | 'bottom' | 'both'; color: string;
    /** An adjustable gradient over the photo, on top of the dim and the preset shade. */
    shade?: Shade | null;
    /** Behind the photo, or the whole design without one: `color` running to this. */
    color2?: string | null;
    /** The background photo's filter. */
    adjust?: Adjust | null;
    /** Designer v2: a gradient (linear at any angle, or radial, any number of stops) as the base, instead of `color` / `color2`. */
    fill?: Gradient | null;
  };
  layers: Layer[];
  /** Size in its own units: the story is 1080 × 1920 (the default), the square 1080 × 1080. */
  frame?: Frame;
  /**
   * The square carries one set of layers for every photo it is used on, but a
   * crop per photo: each photo's placement lives here, keyed by its id.
   */
  placements?: Record<string, Placement>;
  /** Designer v2: what the design is, where its subject sits (for resizing), the user's guides and grid (for snapping). */
  meta?: { template?: string; master?: string; guides?: { x: number[]; y: number[] }; subject?: Box01; grid?: number };
}

export const SQUARE_FRAME: Frame = { w: 1080, h: 1080 };
export const frameOf = (d: StoryDoc): Frame => d.frame ?? STORY_FRAME;
const FILL: Placement = { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 };
/** The placement of the photo on show — per photo when the document keeps them. */
export const placementOf = (d: StoryDoc): Placement =>
  d.placements ? (d.bg.photoId ? d.placements[d.bg.photoId] : undefined) ?? FILL : d.bg.placement;
export const withPlacement = (d: StoryDoc, p: Placement): StoryDoc =>
  d.placements && d.bg.photoId ? { ...d, placements: { ...d.placements, [d.bg.photoId]: p } } : { ...d, bg: { ...d.bg, placement: p } };

export type ExtraFamily = 'cormorant' | 'playfair' | 'script' | 'montserrat' | 'cinzel' | 'cormorantInfant' | 'italiana' | 'jost' | 'tenor' | 'dmSerif' | 'marcellus';
/** The CSS families behind the font keys; the designer's extra faces fall back to the house three. */
export interface FontFamilies { headline: string; body: string; serif: string; extra?: Partial<Record<ExtraFamily, string>> }
export interface Assets {
  photos: Record<string, HTMLImageElement>;
  /** This house's marks, loaded from their SVGs; a house without a monogram has no `t`. */
  marks: Partial<Record<MarkKind, HTMLImageElement>>;
  fonts: FontFamilies;
  /** The dark ink automatic colour uses on a light ground (default near-black; Mina's catalogue marks are maroon). */
  ink?: string;
}
export type Fields = Record<Bind, string>;

export const newLayerId = (k: string) => `${k}-${Math.random().toString(36).slice(2, 8)}`;

// ── Fonts ──────────────────────────────────────────────────────────────────

export const FONT_LABEL: Record<FontKey, string> = {
  condensed: 'Condensed (headline)', light: 'Light', regular: 'Regular', bold: 'Bold',
  serif: 'Didone', 'serif-italic': 'Didone italic', futura: 'Futura (stamp)',
  cormorant: 'Cormorant', 'cormorant-italic': 'Cormorant italic', playfair: 'Playfair', script: 'Script',
  montserrat: 'Montserrat', 'montserrat-bold': 'Montserrat bold', cinzel: 'Cinzel (capitals)',
  'cormorant-infant': 'Cormorant Infant', italiana: 'Italiana', jost: 'Jost', tenor: 'Tenor Sans', 'dm-serif': 'DM Serif', marcellus: 'Marcellus',
};
export const FONT_KEYS = Object.keys(FONT_LABEL) as FontKey[];

export function fontCss(font: FontKey, size: number, f: FontFamilies): string {
  const x = f.extra ?? {};
  switch (font) {
    case 'condensed': return `800 ${size}px ${f.headline}`;
    case 'light': return `300 ${size}px ${f.body}`;
    case 'regular': return `400 ${size}px ${f.body}`;
    case 'bold': return `700 ${size}px ${f.body}`;
    case 'serif': return `500 ${size}px ${f.serif}`;
    case 'serif-italic': return `italic 400 ${size}px ${f.serif}`;
    case 'futura': return `300 ${size}px "Taheri Stamp", Futura, "Century Gothic", sans-serif`;
    case 'cormorant': return `500 ${size}px ${x.cormorant ?? f.serif}`;
    case 'cormorant-italic': return `italic 500 ${size}px ${x.cormorant ?? f.serif}`;
    case 'playfair': return `700 ${size}px ${x.playfair ?? f.serif}`;
    case 'script': return `400 ${size}px ${x.script ?? f.serif}`;
    case 'montserrat': return `400 ${size}px ${x.montserrat ?? f.body}`;
    case 'montserrat-bold': return `700 ${size}px ${x.montserrat ?? f.body}`;
    case 'cinzel': return `500 ${size}px ${x.cinzel ?? f.serif}`;
    case 'cormorant-infant': return `500 ${size}px ${x.cormorantInfant ?? f.serif}`;
    case 'italiana': return `400 ${size}px ${x.italiana ?? f.serif}`;
    case 'jost': return `400 ${size}px ${x.jost ?? f.body}`;
    case 'tenor': return `400 ${size}px ${x.tenor ?? f.body}`;
    case 'dm-serif': return `400 ${size}px ${x.dmSerif ?? f.serif}`;
    case 'marcellus': return `400 ${size}px ${x.marcellus ?? f.serif}`;
  }
}

/** The bolder / italic twin of a font, for the toolbar's B and I (null when it has none). */
export const BOLD_OF: Partial<Record<FontKey, FontKey>> = { light: 'regular', regular: 'bold', bold: 'regular', montserrat: 'montserrat-bold', 'montserrat-bold': 'montserrat' };
export const ITALIC_OF: Partial<Record<FontKey, FontKey>> = { serif: 'serif-italic', 'serif-italic': 'serif', cormorant: 'cormorant-italic', 'cormorant-italic': 'cormorant' };

// ── Text layout ────────────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;
const setSpacing = (ctx: Ctx, px: number) => { (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${px}px`; };

export function textOf(l: TextLayer, fields: Fields): string {
  const t = l.bind ? fields[l.bind] : l.text;
  return l.upper ? (t || '').toUpperCase() : (t || '');
}

function wrap(ctx: Ctx, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      if (ctx.measureText(`${line} ${w}`).width <= width) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

function balancedTwo(text: string): string[] | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  let best: string[] | null = null, diff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
    if (Math.abs(a.length - b.length) < diff) { diff = Math.abs(a.length - b.length); best = [a, b]; }
  }
  return best;
}

export interface TextLayout { lines: string[]; size: number; widths: number[]; w: number; h: number; /** Set for rich text (runs or a list). */ rich?: RichLayout }

/** Lines, the size actually used, and the box they make. */
export function layoutText(ctx: Ctx, l: TextLayer, fields: Fields, fonts: FontFamilies): TextLayout {
  if (hasRich(l)) {
    const r = richLayoutFor(ctx, l, fields, fonts);
    return { lines: r.lines.map(x => (x.marker ? x.marker.text : '') + x.pieces.map(p => p.text).join('')), size: r.size, widths: r.lines.map(x => x.w), w: r.w, h: r.h, rich: r };
  }
  const text = textOf(l, fields);
  let size = l.size;
  ctx.font = fontCss(l.font, size, fonts);
  setSpacing(ctx, l.spacing * size);
  let lines = wrap(ctx, text, l.fit ? Infinity : l.width);
  if (l.fit && lines.length) {
    const widest = Math.max(...lines.map(s => ctx.measureText(s).width), 1);
    if (widest > l.width) {
      const shrunk = Math.floor(size * (l.width / widest));
      const two = lines.length === 1 ? balancedTwo(lines[0]) : null;
      if (two && shrunk < size * 0.72) {
        const w2 = Math.max(...two.map(s => ctx.measureText(s).width), 1);
        const s2 = Math.min(size, Math.floor(size * (l.width / w2)));
        if (s2 > shrunk) { lines = two; size = s2; } else size = shrunk;
      } else size = shrunk;
      ctx.font = fontCss(l.font, size, fonts);
      setSpacing(ctx, l.spacing * size);
    }
  }
  const widths = lines.map(s => ctx.measureText(s).width);
  const w = Math.max(0, ...widths);
  const h = lines.length ? size * (l.lineHeight * (lines.length - 1) + 1) : 0;
  return { lines, size, widths, w, h };
}


// ── Rich text: runs of different styles in one box, and lists ──
// A text layer with `runs` or a `list` is laid out here instead of by the single-style path above (which draws
// every document saved before Designer v2 exactly as it always did). The words are split into characters, each
// resolved to a style (the layer's, overridden by the runs that cover it), grouped into pieces of one style,
// then wrapped greedily word by word across the pieces. Bent text ignores runs and lists.

interface CharStyle { font: FontKey; color: string; mult: number; upper: boolean; underline: boolean; gradient: Gradient | null; own: boolean; key: string }
export interface RichPiece { text: string; st: CharStyle; w: number }
export interface RichLine { pieces: RichPiece[]; marker: RichPiece | null; markerW: number; w: number; size: number; top: number; baseline: number }
export interface RichLayout { lines: RichLine[]; size: number; w: number; h: number }

export const hasRich = (l: TextLayer): boolean => !isCurved(l) && !!((l.runs && l.runs.length) || l.list);

/** The words as the layer's runs index them: the field it is bound to, or its own text. */
const rawOf = (l: TextLayer, fields: Fields): string => (l.bind ? fields[l.bind] : l.text) || '';

function styleAt(l: TextLayer, runs: TextRun[], i: number): CharStyle {
  let font = l.font, color = l.color, mult = 1, upper = l.upper, underline = !!l.underline;
  let gradient: Gradient | null = l.fillGradient ?? null, own = false, gi = -1;
  runs.forEach((r, k) => {
    if (i < r.from || i >= r.to) return;
    if (r.font) font = r.font;
    if (r.color) { color = r.color; gradient = null; own = false; gi = -1; }
    if (r.size && r.size > 0) mult = r.size;
    if (r.upper !== undefined) upper = r.upper;
    if (r.underline !== undefined) underline = r.underline;
    if (r.gradient) { gradient = r.gradient; own = true; gi = k; }
  });
  return { font, color, mult, upper, underline, gradient, own, key: `${font}|${color}|${mult}|${upper}|${underline}|${gi}` };
}

const upperOf = (c: string) => { const u = c.toUpperCase(); return u.length === c.length ? u : c; };

/** Lay out a rich text layer. `scale` shrinks every size (for `fit`). */
export function layoutRich(ctx: Ctx, l: TextLayer, fields: Fields, fonts: FontFamilies, scale = 1): RichLayout {
  const raw = rawOf(l, fields);
  const runs = normalizeRuns(l.runs, raw.length);
  const px = (st: CharStyle) => l.size * st.mult * scale;
  const measure = (text: string, st: CharStyle) => {
    const sz = px(st);
    ctx.font = fontCss(st.font, sz, fonts);
    setSpacing(ctx, l.spacing * sz);
    return ctx.measureText(text).width;
  };
  const piece = (chars: { ch: string; st: CharStyle }[]): RichPiece[] => {
    const out: RichPiece[] = [];
    for (const c of chars) {
      const last = out[out.length - 1];
      if (last && last.st.key === c.st.key) last.text += c.ch;
      else out.push({ text: c.ch, st: c.st, w: 0 });
    }
    for (const p of out) p.w = measure(p.text, p.st);
    return out;
  };
  // Characters with their styles, split into paragraphs at line breaks.
  const paras: { ch: string; st: CharStyle }[][] = [[]];
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch === '\n') { paras.push([]); continue; }
    const st = styleAt(l, runs, i);
    if (ch >= '\ud800' && ch <= '\udbff' && i + 1 < raw.length) ch += raw[++i];
    paras[paras.length - 1].push({ ch: st.upper ? upperOf(ch) : ch, st });
  }
  const base = styleAt(l, [], 0);
  const lineSize = (ps: RichPiece[]) => Math.max(px(base), ...ps.map(p => px(p.st)));
  const avail = l.fit ? Infinity : l.width;
  const lines: RichLine[] = [];
  let n = 0;
  for (const chars of paras) {
    // Words (collapsing runs of spaces to one, in the style of the first).
    const words: { chars: { ch: string; st: CharStyle }[]; space: { ch: string; st: CharStyle } | null }[] = [];
    let word: { ch: string; st: CharStyle }[] = [], gap: { ch: string; st: CharStyle } | null = null;
    for (const c of chars) {
      if (/\s/.test(c.ch)) { if (word.length) { words.push({ chars: word, space: null }); word = []; } if (!gap) gap = { ch: ' ', st: c.st }; }
      else { if (gap && words.length) words[words.length - 1].space = gap; gap = null; word.push(c); }
    }
    if (word.length) words.push({ chars: word, space: null });
    // The marker, if the paragraph has anything in it.
    let marker: RichPiece | null = null;
    if (l.list && words.length) {
      n++;
      marker = { text: l.list === 'number' ? `${n}. ` : '• ', st: base, w: 0 };
      marker.w = measure(marker.text, base);
    }
    const markerW = marker ? marker.w : 0;
    if (!words.length) { lines.push({ pieces: [], marker: null, markerW: 0, w: 0, size: px(base), top: 0, baseline: 0 }); continue; }
    let cur: RichPiece[] = [], curW = 0, first = true;
    const flush = () => {
      // Neighbours of one style (a word and the space after it) draw as one piece.
      const joined: RichPiece[] = [];
      for (const p of cur) {
        const prev = joined[joined.length - 1];
        if (prev && prev.st.key === p.st.key) joined[joined.length - 1] = { text: prev.text + p.text, st: prev.st, w: prev.w + p.w };
        else joined.push(p);
      }
      lines.push({ pieces: joined, marker: first ? marker : null, markerW, w: markerW + curW, size: lineSize(joined), top: 0, baseline: 0 });
      cur = []; curW = 0; first = false;
    };
    words.forEach((wd, wi) => {
      const wp = piece(wd.chars), ww = wp.reduce((s, p) => s + p.w, 0);
      const prevSpace = wi > 0 ? words[wi - 1].space : null;
      const sp = prevSpace ? piece([prevSpace]) : [];
      const sw = sp.reduce((s, p) => s + p.w, 0);
      if (cur.length && markerW + curW + sw + ww > avail) flush();
      const add = cur.length ? [...sp, ...wp] : wp;
      cur.push(...add); curW += add.reduce((s, p) => s + p.w, 0);
    });
    flush();
  }
  // Heights: each line is as tall as its biggest type; the first baseline sits 0.82 of that below its top, like the plain path.
  let top = 0;
  lines.forEach(ln => {
    ln.top = top;
    ln.baseline = top + ln.size * 0.82;
    top += ln.size * l.lineHeight;
  });
  const last = lines[lines.length - 1];
  const h = last ? last.top + last.size : 0;
  const w = Math.max(0, ...lines.map(x => x.w));
  return { lines, size: px(base), w, h };
}

/** A rich layout, shrunk to the layer's width when `fit` asks (one pass, like the plain path). */
function richLayoutFor(ctx: Ctx, l: TextLayer, fields: Fields, fonts: FontFamilies): RichLayout {
  let r = layoutRich(ctx, l, fields, fonts);
  if (l.fit && r.w > l.width && r.w > 0) {
    const shrunk = Math.max(1, Math.floor(l.size * (l.width / r.w)));
    r = layoutRich(ctx, l, fields, fonts, shrunk / l.size);
  }
  return r;
}

/** Runs kept inside the words (0…len), in order, without empty ones. */
export function normalizeRuns(runs: TextRun[] | undefined, len: number): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs ?? []) {
    if (!r || !Number.isFinite(r.from) || !Number.isFinite(r.to)) continue;
    const from = Math.max(0, Math.min(len, Math.round(r.from))), to = Math.max(0, Math.min(len, Math.round(r.to)));
    if (to > from) out.push({ ...r, from, to });
  }
  return out;
}

type RunProps = Omit<TextRun, 'from' | 'to'>;
const runSig = (p: RunProps) => JSON.stringify(Object.keys(p).sort().map(k => [k, (p as Record<string, unknown>)[k]]));

/**
 * Style characters `from`…`to` (a toolbar's selection): the runs are cut at the edges, the patch is laid over
 * what is there, a key set to `undefined` clears it, and neighbours with the same style join. Returns the new
 * runs (empty styles dropped).
 */
export function setRunStyle(runs: TextRun[] | undefined, from: number, to: number, patch: Partial<RunProps>, len: number): TextRun[] {
  const cur = normalizeRuns(runs, len);
  const a = Math.max(0, Math.min(len, Math.round(from))), b = Math.max(0, Math.min(len, Math.round(to)));
  if (b <= a) return cur;
  const cuts = new Set<number>([0, len, a, b]);
  for (const r of cur) { cuts.add(r.from); cuts.add(r.to); }
  const pts = [...cuts].sort((x, y) => x - y);
  const pieces: { from: number; to: number; style: RunProps }[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const f = pts[i], t = pts[i + 1];
    const style: Record<string, unknown> = {};
    for (const r of cur) if (r.from <= f && r.to >= t) for (const [k, v] of Object.entries(r)) if (k !== 'from' && k !== 'to' && v !== undefined) style[k] = v;
    if (f >= a && t <= b) for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete style[k]; else style[k] = v; }
    if (Object.keys(style).length) {
      const prev = pieces[pieces.length - 1];
      if (prev && prev.to === f && runSig(prev.style) === runSig(style as RunProps)) prev.to = t;
      else pieces.push({ from: f, to: t, style: style as RunProps });
    }
  }
  return pieces.map(p => ({ from: p.from, to: p.to, ...p.style }));
}

/**
 * The runs after the words were edited: `removed` characters taken out at `at` and `added` put in. Typing at
 * the end of a styled stretch carries the style on; typing at its start does not.
 */
export function shiftRuns(runs: TextRun[] | undefined, at: number, removed: number, added: number): TextRun[] {
  const move = (p: number) => (p < at ? p : p >= at + removed ? p + added - removed : at);
  const out: TextRun[] = [];
  for (const r of runs ?? []) {
    const from = move(r.from), to = move(r.to);
    if (to > from) out.push({ ...r, from, to });
  }
  return out;
}

// ── Bounds and hit-testing ─────────────────────────────────────────────────

export type { Box } from './design';
import type { Box } from './design';

let measureCtx: Ctx | null = null;
const mctx = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

// ── Bent text ──
// Each letter placed on an arc and turned to follow it. Laid out around the
// origin first, then moved so its box sits where a straight line would: top at
// `y`, its left, centre or right edge at `x` by `align`.

interface Run { s: string; x: number; y: number; rot: number; /** Rich text: this piece's own font, letter spacing (px) and fill. */ font?: string; spacing?: number; fill?: string | CanvasGradient }
export const isCurved = (l: TextLayer) => !!l.curve && Math.abs(l.curve) >= 1;

function curveLayout(ctx: Ctx, l: TextLayer, fields: Fields, fonts: FontFamilies): { runs: Run[]; box: Box; size: number } {
  const text = textOf(l, fields).replace(/\s*\n\s*/g, ' ');
  const size = l.size;
  ctx.font = fontCss(l.font, size, fonts);
  setSpacing(ctx, l.spacing * size);
  const chars = [...text];
  const widths = chars.map(ch => ctx.measureText(ch).width);
  const total = Math.max(1, widths.reduce((s, w) => s + w, 0));
  const c = Math.max(-100, Math.min(100, l.curve ?? 0));
  const theta = (Math.abs(c) / 100) * Math.PI * 1.8;
  const R = total / theta;
  const up = c > 0;
  const runs: Run[] = [];
  let at = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const asc = size * 0.82, desc = size * 0.2;
  chars.forEach((s, i) => {
    const mid = (at + widths[i] / 2) / R;
    at += widths[i];
    const phi = up ? -Math.PI / 2 - theta / 2 + mid : Math.PI / 2 + theta / 2 - mid;
    const x = R * Math.cos(phi), y = R * Math.sin(phi) + (up ? R : -R);
    const rot = up ? phi + Math.PI / 2 : phi - Math.PI / 2;
    runs.push({ s, x, y, rot });
    // The letter's corners, turned, for the box.
    const hw = widths[i] / 2, cos = Math.cos(rot), sin = Math.sin(rot);
    for (const [px, py] of [[-hw, -asc], [hw, -asc], [-hw, desc], [hw, desc]]) {
      const gx = x + px * cos - py * sin, gy = y + px * sin + py * cos;
      minX = Math.min(minX, gx); maxX = Math.max(maxX, gx); minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
    }
  });
  if (!runs.length) return { runs, box: { x: l.x, y: l.y, w: 0, h: 0 }, size };
  const w = maxX - minX, h = maxY - minY;
  const left = l.align === 'left' ? l.x : l.align === 'center' ? l.x - w / 2 : l.x - w;
  const dx = left - minX, dy = l.y - minY;
  return { runs: runs.map(r => ({ ...r, x: r.x + dx, y: r.y + dy })), box: { x: left, y: l.y, w, h }, size };
}

// ── Images the counter uploads ──
// Kept by their data URL, which is also what the layer stores, so a saved
// layout brings its logo with it. Loaded once; drawing only ever reads.

const uploads = new Map<string, HTMLImageElement>();
const uploading = new Map<string, Promise<HTMLImageElement>>();
export const uploadedImage = (src: string) => uploads.get(src);
export function loadUpload(src: string): Promise<HTMLImageElement> {
  const have = uploads.get(src);
  if (have) return Promise.resolve(have);
  let p = uploading.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { uploads.set(src, img); uploading.delete(src); resolve(img); };
      img.onerror = () => { uploading.delete(src); reject(new Error('That image could not be read.')); };
      img.src = src;
    });
    uploading.set(src, p);
  }
  return p;
}
type Pic = HTMLImageElement;
export const imageOf = (l: ImageLayer, a: Assets): Pic | undefined => (l.src ? uploads.get(l.src) : a.photos[l.photoId]);
/**
 * The photo inside a frame, moved by a drag of (dx, dy) story px from where it was: the frame stays,
 * the crop slides (Canva's double-click into a frame). Clamped so the photo always covers the frame.
 */
export function panInFrame(l: ImageLayer, img: Pic | undefined, fx0: number, fy0: number, dx: number, dy: number): Pick<ImageLayer, 'fx' | 'fy'> {
  const w = l.w, h = l.h ?? l.w * ratioOf(img);
  const iw = img?.naturalWidth || w, ih = img?.naturalHeight || h;
  const s = Math.max(w / iw, h / ih) * Math.max(1, l.iz ?? 1);
  const spareX = iw * s - w, spareY = ih * s - h;
  const cl = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  return { fx: spareX > 0.5 ? cl(fx0 - dx / spareX) : 0.5, fy: spareY > 0.5 ? cl(fy0 - dy / spareY) : 0.5 };
}

const ratioOf = (img: Pic | undefined) => (img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1);

export function layerBox(l: Layer, fields: Fields, a: Assets): Box {
  switch (l.kind) {
    case 'text': {
      const pad = l.box ? l.box.pad : 0;
      if (isCurved(l)) {
        const b = curveLayout(mctx(), l, fields, a.fonts).box;
        return { x: b.x - pad, y: b.y - pad, w: Math.max(b.w + pad * 2, 20), h: Math.max(b.h + pad * 2, 20) };
      }
      const t = layoutText(mctx(), l, fields, a.fonts);
      const w = t.w + pad * 2, h = t.h + pad * 2;
      const x = l.align === 'left' ? l.x - pad : l.align === 'center' ? l.x - w / 2 : l.x - w + pad;
      return { x, y: l.y - pad, w: Math.max(w, 20), h: Math.max(h, 20) };
    }
    case 'wordmark': {
      const m = a.marks[l.mark] ?? a.marks.wordmark;
      const h = l.width * (m && m.naturalWidth ? m.naturalHeight / m.naturalWidth : l.mark === 't' ? 2 : 0.25);
      return { x: l.x, y: l.y, w: l.width, h };
    }
    case 'image': {
      return { x: l.x, y: l.y, w: l.w, h: l.h ?? l.w * ratioOf(imageOf(l, a)) };
    }
    case 'qr': return { x: l.x, y: l.y, w: l.w, h: l.w };
    default: {
      const x = Math.min(l.x, l.x + l.w), y = Math.min(l.y, l.y + l.h);
      const pad = l.kind === 'arrow' || l.kind === 'line' ? Math.max(24, l.stroke * 2 + Math.abs(l.curve)) : 0;
      return { x: x - pad, y: y - pad, w: Math.abs(l.w) + pad * 2, h: Math.abs(l.h) + pad * 2 };
    }
  }
}

/** The topmost visible layer under a story point, allowing for rotation. */
export function hitTest(doc: StoryDoc, px: number, py: number, fields: Fields, a: Assets): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.hidden) continue;
    const b = layerBox(l, fields, a);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const r = (-l.rotate * Math.PI) / 180;
    const dx = px - cx, dy = py - cy;
    const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
    const slop = 16;
    if (Math.abs(lx) <= b.w / 2 + slop && Math.abs(ly) <= b.h / 2 + slop) return l;
  }
  return null;
}

/** Move a layer by (dx, dy) story pixels. A moved line leaves its preset's stack and stays where it is put. */
export function moveLayer(l: Layer, dx: number, dy: number): Layer {
  return (l.kind === 'text' ? { ...l, x: l.x + dx, y: l.y + dy, flow: undefined } : { ...l, x: l.x + dx, y: l.y + dy }) as Layer;
}

/**
 * The document as it should look with these words: every stacked line placed
 * under the one above it. The first line of the stack keeps its own top; an
 * empty line takes no room. Used for drawing, hit-testing and export alike,
 * so what is seen is what is posted.
 */
export function reflow(doc: StoryDoc, fields: Fields, a: Assets): StoryDoc {
  let bottom: number | null = null;
  let changed = false;
  const layers = doc.layers.map(l => {
    if (l.kind !== 'text' || !l.flow || l.hidden) return l;
    const empty = !textOf(l, fields).trim();
    const y = bottom === null ? l.y : bottom + (empty ? 0 : l.flow.gap);
    const placed = y === l.y ? l : { ...l, y };
    if (placed !== l) changed = true;
    if (!empty) bottom = y + layoutText(mctx(), placed, fields, a.fonts).h;
    else if (bottom === null) bottom = y;
    return placed;
  });
  return changed ? { ...doc, layers } : doc;
}

/** Grow or shrink a layer by a factor around its own anchor. */
export function scaleLayer(l: Layer, k: number): Layer {
  const c = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  switch (l.kind) {
    case 'text': return { ...l, size: c(Math.round(l.size * k), 12, 600), width: c(Math.round(l.width * k), 80, 2400), box: l.box ? { ...l.box, pad: Math.round(l.box.pad * k), radius: Math.round(l.box.radius * k) } : null };
    case 'wordmark': return { ...l, width: c(Math.round(l.width * k), 60, 1080) };
    case 'image': return { ...l, w: c(Math.round(l.w * k), 40, 2400), ...(l.h ? { h: c(Math.round(l.h * k), 40, 3000) } : {}) };
    case 'qr': return { ...l, w: c(Math.round(l.w * k), 60, 2400) };
    default: return { ...l, w: Math.round(l.w * k), h: Math.round(l.h * k), stroke: c(Math.round(l.stroke * Math.sqrt(k)), 1, 60) };
  }
}

/**
 * Layers carried from one design to the other — the story's to the square, or
 * back. Each lands with its centre at the same fraction of the new page's width
 * and height, shrinks going to the shorter page (and never grows going to the
 * taller one), and gets new ids (and new group ids). A bound line the other
 * design already shows comes across as free text, as a paste would.
 */
export function carryLayers(layers: Layer[], from: Frame, to: StoryDoc, fields: Fields, a: Assets): Layer[] {
  const tf = frameOf(to);
  const k = Math.min(1, Math.sqrt((tf.w * tf.h) / (from.w * from.h)));
  const groups = new Map<string, string>();
  return layers.map(src => {
    let l = { ...(k < 1 ? scaleLayer(src, k) : src), id: newLayerId(src.kind), locked: false } as Layer;
    const b0 = layerBox(src, fields, a), b = layerBox(l, fields, a);
    const cx = ((b0.x + b0.w / 2) / from.w) * tf.w, cy = ((b0.y + b0.h / 2) / from.h) * tf.h;
    l = moveLayer(l, Math.round(cx - (b.x + b.w / 2)), Math.round(cy - (b.y + b.h / 2)));
    if (l.group) { if (!groups.has(l.group)) groups.set(l.group, newLayerId('grp')); l = { ...l, group: groups.get(l.group) }; }
    if (l.kind === 'text' && l.bind) {
      const bind = l.bind;
      if (to.layers.some(x => x.kind === 'text' && x.bind === bind)) l = { ...l, bind: undefined, text: fields[bind] };
    }
    return l;
  });
}

// ── Drawing ────────────────────────────────────────────────────────────────

/** "#RRGGBB" at an alpha, for shadows and glows. */
function rgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, alpha))})`;
}

/** The effect a layer draws with; the older on/off shadow reads as a soft drop shadow. */
export const effectOf = (l: TextLayer): TextEffect | null =>
  l.effect ?? (l.shadow ? { kind: 'shadow', color: '#000000', offset: 16, angle: 90, blur: 36, thickness: 0, transparency: 65 } : null);

function drawText(ctx: Ctx, l: TextLayer, fields: Fields, a: Assets) {
  const curved = isCurved(l);
  const t = curved ? null : layoutText(ctx, l, fields, a.fonts);
  const bent = curved ? curveLayout(ctx, l, fields, a.fonts) : null;
  if (t ? !t.lines.some(Boolean) : !bent!.runs.length) return;
  const size = t ? t.size : bent!.size;
  const rich = t?.rich ?? null;
  ctx.textBaseline = 'alphabetic';
  if (l.box) {
    const b = layerBox(l, fields, a);
    ctx.save();
    ctx.fillStyle = l.box.color;
    roundRect(ctx, b.x, b.y, b.w, b.h, l.box.radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = fontCss(l.font, size, a.fonts);
  setSpacing(ctx, l.spacing * size);
  ctx.lineJoin = 'round';
  // The box the words fill, for a gradient laid over all of them.
  const tw = t ? t.w : bent!.box.w, th = t ? t.h : bent!.box.h;
  const tbox = bent ? bent.box : { x: l.align === 'left' ? l.x : l.align === 'center' ? l.x - tw / 2 : l.x - tw, y: l.y, w: tw, h: th };
  const baseFill: string | CanvasGradient = l.fillGradient ? makeGradient(ctx, l.fillGradient, tbox) : l.color;
  // What gets painted: whole lines (first baseline about 0.82 of the size below
  // the top for these faces), or one letter at a time round the arc, or the pieces of a rich text.
  const underlines: { x: number; y: number; w: number; h: number; fill: string | CanvasGradient }[] = [];
  const runs: Run[] = rich
    ? richRuns(ctx, l, rich, a.fonts, tbox, underlines)
    : t
      ? t.lines.map((s, i) => ({ s, x: l.x, y: l.y + t.size * 0.82 + i * t.size * l.lineHeight, rot: 0 }))
      : bent!.runs;
  ctx.textAlign = rich ? 'left' : t ? l.align : 'center';
  const paint = (how: 'fill' | 'stroke', dx = 0, dy = 0, own = false) => {
    for (const r of runs) {
      if (r.font) { ctx.font = r.font; setSpacing(ctx, r.spacing ?? 0); }
      if (own && how === 'fill' && r.fill) ctx.fillStyle = r.fill;
      if (r.rot) {
        ctx.save(); ctx.translate(r.x + dx, r.y + dy); ctx.rotate(r.rot);
        if (how === 'fill') ctx.fillText(r.s, 0, 0); else ctx.strokeText(r.s, 0, 0);
        ctx.restore();
      } else if (how === 'fill') ctx.fillText(r.s, r.x + dx, r.y + dy);
      else ctx.strokeText(r.s, r.x + dx, r.y + dy);
    }
  };
  const fx = effectOf(l);
  const dist = (fx ? fx.offset / 100 : 0) * size * 0.25;
  const ang = ((fx?.angle ?? 45) * Math.PI) / 180;
  const ox = Math.cos(ang) * dist, oy = Math.sin(ang) * dist;
  const line = (k: number) => Math.max(1, ((fx?.thickness ?? 40) / 100) * size * k);
  const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  ctx.fillStyle = baseFill;
  ctx.strokeStyle = l.color;
  switch (fx?.kind) {
    case 'shadow':
      ctx.shadowColor = rgba(fx.color, 1 - fx.transparency / 100);
      ctx.shadowBlur = (fx.blur / 100) * size * 0.5;
      ctx.shadowOffsetX = ox; ctx.shadowOffsetY = oy;
      paint('fill', 0, 0, true); noShadow();
      break;
    case 'lift':
      ctx.shadowColor = rgba('#000000', 0.15 + 0.55 * (1 - fx.transparency / 100));
      ctx.shadowBlur = size * 0.3; ctx.shadowOffsetY = size * 0.07;
      paint('fill', 0, 0, true); noShadow();
      break;
    case 'hollow':
      ctx.lineWidth = line(0.08);
      paint('stroke');
      break;
    case 'outline':
      ctx.strokeStyle = fx.color; ctx.lineWidth = line(0.14) * 2;
      paint('stroke'); paint('fill', 0, 0, true);
      break;
    case 'splice':
      ctx.fillStyle = fx.color; paint('fill', ox, oy);
      ctx.lineWidth = line(0.07); paint('stroke');
      break;
    case 'echo': {
      // Three fading copies trailing off in the effect's direction, the words on top.
      const was = ctx.globalAlpha;
      ctx.fillStyle = fx.color;
      for (const k of [3, 2, 1]) { ctx.globalAlpha = was * 0.18 * (4 - k); paint('fill', ox * k, oy * k); }
      ctx.globalAlpha = was;
      ctx.fillStyle = baseFill; paint('fill', 0, 0, true);
      break;
    }
    case 'neon':
      ctx.shadowColor = rgba(fx.color, 1);
      ctx.shadowBlur = size * (0.1 + (fx.blur / 100) * 0.45);
      paint('fill', 0, 0, true); paint('fill', 0, 0, true); noShadow();
      ctx.fillStyle = rgba('#FFFFFF', 0.55); paint('fill');
      break;
    case 'glitch': {
      const o = Math.max(2, (fx.offset / 100) * size * 0.1);
      ctx.fillStyle = '#00E5FF'; paint('fill', -o, 0);
      ctx.fillStyle = '#FF2E88'; paint('fill', o, 0);
      ctx.fillStyle = baseFill; paint('fill', 0, 0, true);
      break;
    }
    default:
      paint('fill', 0, 0, true);
  }
  if (rich) {
    for (const u of underlines) { ctx.fillStyle = u.fill; ctx.fillRect(u.x, u.y, u.w, u.h); }
  } else if (l.underline && t) {
    ctx.fillStyle = baseFill;
    const th2 = Math.max(2, size * 0.055);
    t.lines.forEach((s, i) => {
      const w = t.widths[i];
      if (!s || !w) return;
      const x0 = l.align === 'left' ? l.x : l.align === 'center' ? l.x - w / 2 : l.x - w;
      ctx.fillRect(x0, runs[i].y + size * 0.12, w, th2);
    });
  }
}

/** The pieces of a rich layout as paint runs (each with its own font and fill), and the underlines to draw after. */
function richRuns(ctx: Ctx, l: TextLayer, r: RichLayout, fonts: FontFamilies, tbox: Box, underlines: { x: number; y: number; w: number; h: number; fill: string | CanvasGradient }[]): Run[] {
  const out: Run[] = [];
  for (const ln of r.lines) {
    let x = l.align === 'left' ? l.x : l.align === 'center' ? l.x - ln.w / 2 : l.x - ln.w;
    const y = l.y + ln.baseline;
    const push = (p: RichPiece) => {
      const sz = r.size * p.st.mult;
      let fill: string | CanvasGradient = p.st.color;
      if (p.st.gradient) fill = makeGradient(ctx, p.st.gradient, p.st.own ? { x, y: l.y + ln.top, w: p.w, h: ln.size } : tbox);
      out.push({ s: p.text, x, y, rot: 0, font: fontCss(p.st.font, sz, fonts), spacing: l.spacing * sz, fill });
      if (p.st.underline && p.text.trim()) underlines.push({ x, y: y + sz * 0.12, w: p.w, h: Math.max(2, sz * 0.055), fill });
      x += p.w;
    };
    if (ln.marker) push(ln.marker);
    for (const p of ln.pieces) push(p);
  }
  return out;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawShape(ctx: Ctx, l: ShapeLayer) {
  ctx.strokeStyle = l.color;
  ctx.lineWidth = l.stroke;
  ctx.lineCap = l.dash === 'dot' ? 'round' : l.dash === 'dash' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  if (l.dash === 'dash') ctx.setLineDash([l.stroke * 3, l.stroke * 2]);
  else if (l.dash === 'dot') ctx.setLineDash([0.01, l.stroke * 2]);
  if (l.kind === 'rect' || l.kind === 'circle' || l.kind === 'shape') {
    const x = Math.min(l.x, l.x + l.w), y = Math.min(l.y, l.y + l.h), w = Math.abs(l.w), h = Math.abs(l.h);
    let path: Path2D | null = null;
    ctx.beginPath();
    if (l.kind === 'rect') roundRect(ctx, x, y, w, h, l.radius);
    else if (l.kind === 'circle') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    else { ctx.translate(x, y); path = new Path2D(SHAPES[l.shape ?? 'star'].path(w, h)); }
    if (l.fill || l.fillGradient) {
      if (l.fillGradient) ctx.fillStyle = makeGradient(ctx, l.fillGradient, { x: path ? 0 : x, y: path ? 0 : y, w, h });
      else if (l.fill2) {
        const g = ctx.createLinearGradient(0, path ? 0 : y, 0, path ? h : y + h);
        g.addColorStop(0, l.fill as string); g.addColorStop(1, l.fill2);
        ctx.fillStyle = g;
      } else ctx.fillStyle = l.fill as string;
      if (path) ctx.fill(path); else ctx.fill();
    }
    if (l.stroke > 0) { if (path) ctx.stroke(path); else ctx.stroke(); }
    ctx.setLineDash([]);
    return;
  }
  // A line or arrow from (x, y) to (x + w, y + h), bowed by `curve`.
  const x1 = l.x, y1 = l.y, x2 = l.x + l.w, y2 = l.y + l.h;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const len = Math.hypot(l.w, l.h) || 1;
  const cx = mx - (l.h / len) * l.curve, cy = my + (l.w / len) * l.curve;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
  if (l.kind === 'arrow') {
    const ang = Math.atan2(y2 - cy, x2 - cx);
    const head = Math.max(18, l.stroke * 4.5);
    ctx.beginPath();
    ctx.moveTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45));
    ctx.stroke();
  }
}

// ── Photo filters, drawn ──
// A filtered copy of a photo is made once per filter and size and kept: the
// pixel work is too slow to redo on every frame of a drag. Sized to what the
// canvas actually needs (so a 3000-px export gets a 3000-px copy, the preview
// a small one), in steps so a zoom doesn't make a new one per pixel.

const adjustedCache = new WeakMap<object, Map<string, HTMLCanvasElement>>();
function adjustedSource(ctx: Ctx, img: Pic, adj: Adjust | null | undefined, drawW: number, drawH: number): Pic | HTMLCanvasElement {
  if (!changesPixels(adj)) return img;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  if (!iw || !ih) return img;
  const m = ctx.getTransform();
  const need = Math.max(drawW, drawH) * Math.hypot(m.a, m.b);
  const long = Math.min(Math.max(iw, ih), Math.max(400, Math.ceil(need / 400) * 400));
  const k = long / Math.max(iw, ih);
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const key = `${JSON.stringify(adj)}|${w}x${h}`;
  let per = adjustedCache.get(img);
  if (!per) { per = new Map(); adjustedCache.set(img, per); }
  let c = per.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w; c.height = h;
    const t = c.getContext('2d', { willReadFrequently: true })!;
    t.drawImage(img, 0, 0, w, h);
    try {
      const data = t.getImageData(0, 0, w, h);
      applyAdjust(data.data, adj!, w, h);
      t.putImageData(data, 0, 0);
    } catch { /* a tainted image: drawn unfiltered */ }
    if (per.size > 6) per.clear();
    per.set(key, c);
  }
  return c;
}

/** The darkened edge of a vignette, over a box already drawn. */
function vignette(ctx: Ctx, x: number, y: number, w: number, h: number, amount: number) {
  if (!amount) return;
  const cx = x + w / 2, cy = y + h / 2, r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, amount / 100 * 0.85)})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function drawImageLayer(ctx: Ctx, l: ImageLayer, a: Assets) {
  const img = imageOf(l, a);
  if (!img || !img.naturalWidth) return;
  const w = l.w, h = l.h ?? l.w * ratioOf(img);
  ctx.save();
  ctx.translate(l.x, l.y);
  const outline = l.mask ? new Path2D(SHAPES[l.mask].path(w, h)) : null;
  const trace = () => { if (outline) return; roundRect(ctx, 0, 0, w, h, l.radius); };
  const put = (src: Pic | HTMLCanvasElement) => {
    if (l.h) {
      // A frame: the photo covers it, cropped around (fx, fy).
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const s = Math.max(w / iw, h / ih) * Math.max(1, l.iz ?? 1);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(src, (w - dw) * (l.fx ?? 0.5), (h - dh) * (l.fy ?? 0.5), dw, dh);
    } else ctx.drawImage(src, 0, 0, w, h);
  };
  if (l.cutout) {
    // A picture with its own outline (alpha): no frame fill or border under it, and its shadow follows the piece.
    if (outline) ctx.clip(outline);
    if (l.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
    put(adjustedSource(ctx, img, l.adjust, w, h));
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.restore();
    return;
  }
  if (l.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
  if (l.border) {
    if (outline) { ctx.strokeStyle = l.border; ctx.lineWidth = 16; ctx.lineJoin = 'round'; ctx.stroke(outline); }
    else { ctx.fillStyle = l.border; roundRect(ctx, -8, -8, w + 16, h + 16, l.radius + 8); ctx.fill(); }
  } else if (l.shadow) {
    // Something for the shadow to fall from; the photo covers it.
    ctx.fillStyle = '#000'; if (outline) ctx.fill(outline); else { trace(); ctx.fill(); }
  }
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  if (outline) ctx.clip(outline); else { trace(); ctx.clip(); }
  put(adjustedSource(ctx, img, l.adjust, w, h));
  if (l.shade) drawShade(ctx, l.shade, 0, 0, w, h);
  vignette(ctx, 0, 0, w, h, l.adjust?.vignette ?? 0);
  ctx.restore();
}

/** A shade over the box (x, y, w, h): the line runs through its centre at the shade's angle, corner to corner. */
export function drawShade(ctx: Ctx, g: Shade, x: number, y: number, w: number, h: number) {
  const a = (g.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2, cx = x + w / 2, cy = y + h / 2;
  const grad = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
  const s0 = Math.max(0, Math.min(1, g.start)), s1 = Math.max(s0, Math.min(1, g.end));
  grad.addColorStop(s0, rgba(g.from, g.fromAlpha));
  grad.addColorStop(s1, rgba(g.to, g.toAlpha));
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

function drawOverlay(ctx: Ctx, bg: StoryDoc['bg'], f: Frame) {
  if (bg.dim > 0) { ctx.fillStyle = `rgba(0,0,0,${bg.dim})`; ctx.fillRect(0, 0, f.w, f.h); }
  const grad = (y0: number, y1: number) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.min(y0, y1), f.w, Math.abs(y1 - y0));
  };
  if (bg.gradient === 'top' || bg.gradient === 'both') grad(0, f.h * 0.42);
  if (bg.gradient === 'bottom' || bg.gradient === 'both') grad(f.h, f.h * 0.58);
  if (bg.shade) drawShade(ctx, bg.shade, 0, 0, f.w, f.h);
}

// ── Shadow, glow and outline for shapes, images, marks and QR codes ──
// The layer is drawn once into a canvas of its own (at the resolution it will appear), then put on the page:
// the glow and the shadow as passes that draw only the soft light (the picture itself is thrown far off the
// page and its shadow offset back, so nothing doubles up), the outline as the layer's silhouette stamped round
// it, and the layer once on top. A semi-transparent layer therefore isn't darkened by its own passes. Layers
// without `layerFx` never come here.

export const hasFx = (fx: LayerFx | undefined): fx is LayerFx =>
  !!fx && !!(fx.shadow || fx.glow || (fx.outline && fx.outline.width > 0));

function withFx(ctx: Ctx, fx: LayerFx | undefined, box: () => Box, extra: number, paint: (c: Ctx) => void) {
  if (!hasFx(fx)) { paint(ctx); return; }
  const b = box();
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  const ow = fx.outline && fx.outline.width > 0 ? Math.min(200, fx.outline.width) : 0;
  const pad = Math.ceil(ow + extra) + 2;
  const s = Math.min(k, 4096 / Math.max(1, b.w + pad * 2, b.h + pad * 2));
  const W = Math.max(1, Math.ceil((b.w + pad * 2) * s)), H = Math.max(1, Math.ceil((b.h + pad * 2) * s));
  const make = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const off = make();
  const oc = off.getContext('2d')!;
  oc.setTransform(s, 0, 0, s, -(b.x - pad) * s, -(b.y - pad) * s);
  paint(oc);
  let src: HTMLCanvasElement = off;
  if (ow > 0) {
    // The silhouette in the outline's colour, stamped round in two rings, then the layer over it.
    const sil = make(), sc = sil.getContext('2d')!;
    sc.drawImage(off, 0, 0);
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = fx.outline!.color;
    sc.fillRect(0, 0, W, H);
    const comp = make(), cc = comp.getContext('2d')!;
    const r = ow * s, n = Math.max(12, Math.min(48, Math.ceil(r * 2)));
    for (const rr of [r, r * 0.5]) for (let i = 0; i < n; i++) cc.drawImage(sil, Math.cos((i * 2 * Math.PI) / n) * rr, Math.sin((i * 2 * Math.PI) / n) * rr);
    cc.drawImage(sil, 0, 0);
    cc.drawImage(off, 0, 0);
    src = comp;
  }
  const dx = b.x - pad, dy = b.y - pad, dw = W / s, dh = H / s;
  // Only the soft light of `src`: drawn BIG device pixels off to the left, its shadow offset back by BIG.
  const BIG = 6000 + ctx.canvas.width;
  const soft = (color: string, blur: number, ox: number, oy: number) => {
    ctx.save();
    const t = ctx.getTransform();
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e - BIG, t.f);
    ctx.shadowColor = color; ctx.shadowBlur = Math.max(0, blur) * k;
    ctx.shadowOffsetX = BIG + ox * k; ctx.shadowOffsetY = oy * k;
    ctx.drawImage(src, dx, dy, dw, dh);
    ctx.restore();
  };
  if (fx.glow) { const c = colorWithAlpha(fx.glow.color, fx.glow.alpha); soft(c, fx.glow.blur, 0, 0); soft(c, fx.glow.blur * 0.6, 0, 0); }
  if (fx.shadow) soft(colorWithAlpha(fx.shadow.color, fx.shadow.alpha), fx.shadow.blur, fx.shadow.x, fx.shadow.y);
  ctx.drawImage(src, dx, dy, dw, dh);
}

/** A QR code: modules in `fg` as one path (no seams between neighbours), `bg` behind it and its quiet zone. */
function drawQr(ctx: Ctx, l: QrLayer) {
  const qr = qrFor(l.value);
  if (!qr) return;
  const quiet = Math.max(0, Math.min(8, Math.round(l.quiet)));
  const cells = qr.size + quiet * 2, cell = l.w / cells;
  if (l.bg) { ctx.fillStyle = l.bg; ctx.fillRect(l.x, l.y, l.w, l.w); }
  ctx.fillStyle = l.fg;
  ctx.beginPath();
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      ctx.rect(l.x + (x + quiet) * cell, l.y + (y + quiet) * cell, run * cell, cell);
      x += run - 1;
    }
  }
  ctx.fill();
}

const BLEND_OP: Record<Blend, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', 'soft-light': 'soft-light',
  'hard-light': 'hard-light', 'color-dodge': 'color-dodge', darken: 'darken', lighten: 'lighten',
};

// ── The catalogue stamp and automatic colour ───────────────────────────────

/**
 * A mark filled with one colour: its SVG drawn at the size it will appear (in
 * device pixels, so a 3000-px export is as sharp as the preview), then painted
 * over through its own shape. Kept, per mark, colour and size, for redraws.
 */
const tintCache = new Map<string, HTMLCanvasElement>();
function drawMark(ctx: Ctx, img: HTMLImageElement, b: Box, colour: string) {
  const m = ctx.getTransform();
  const pw = Math.max(1, Math.round(b.w * Math.hypot(m.a, m.b))), ph = Math.max(1, Math.round(b.h * Math.hypot(m.c, m.d)));
  const key = `${img.src}|${colour}|${pw}x${ph}`;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const t = c.getContext('2d')!;
    t.drawImage(img, 0, 0, pw, ph);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = colour;
    t.fillRect(0, 0, pw, ph);
    if (tintCache.size > 60) tintCache.clear();
    tintCache.set(key, c);
  }
  ctx.drawImage(c, b.x, b.y, b.w, b.h);
}

/**
 * White or the tool's near-black, whichever reads over what is already drawn
 * under this box. Reads the pixels through the current transform, so it works
 * on the preview and on a 3000-px export alike.
 */
function autoInk(ctx: Ctx, b: Box, dark = '#1a1a1a'): string {
  try {
    const m = ctx.getTransform();
    const x = Math.max(0, Math.round(m.a * b.x + m.e)), y = Math.max(0, Math.round(m.d * b.y + m.f));
    const w = Math.max(1, Math.round(m.a * b.w)), h = Math.max(1, Math.round(m.d * b.h));
    const d = ctx.getImageData(x, y, Math.min(w, ctx.canvas.width - x), Math.min(h, ctx.canvas.height - y)).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 64) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return n && sum / n > 170 ? dark : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

export function renderDoc(ctx: Ctx, doc: StoryDoc, fields: Fields, a: Assets, opts: { background?: HTMLImageElement | null; hideBound?: boolean } = {}) {
  const f = frameOf(doc);
  ctx.save();
  ctx.clearRect(0, 0, f.w, f.h);
  if (doc.bg.fill) {
    ctx.fillStyle = makeGradient(ctx, doc.bg.fill, { x: 0, y: 0, w: f.w, h: f.h });
  } else if (doc.bg.color2) {
    const g = ctx.createLinearGradient(0, 0, 0, f.h);
    g.addColorStop(0, doc.bg.color); g.addColorStop(1, doc.bg.color2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = doc.bg.color;
  ctx.fillRect(0, 0, f.w, f.h);
  const photo = opts.background ?? (doc.bg.photoId ? a.photos[doc.bg.photoId] : null);
  if (photo) {
    const pl = opts.background ? FILL : placementOf(doc);
    const src = opts.background ? photo : adjustedSource(ctx, photo, doc.bg.adjust, f.w * pl.zoom, f.h * pl.zoom);
    drawStoryPhoto(ctx, src, pl, f);
    if (!opts.background) vignette(ctx, 0, 0, f.w, f.h, doc.bg.adjust?.vignette ?? 0);
  }
  if (!opts.background) drawOverlay(ctx, doc.bg, f);
  for (const l of doc.layers) {
    if (l.hidden || (opts.hideBound && l.kind === 'text' && l.bind)) continue;
    ctx.save();
    // Automatic ink is decided from what is under the layer, before it is drawn or turned.
    const ink = (l.kind === 'text' || l.kind === 'wordmark') && l.autoColor && !(l.kind === 'text' && l.fillGradient) ? autoInk(ctx, layerBox(l, fields, a), a.ink) : null;
    ctx.globalAlpha = l.opacity;
    if (l.blend && l.blend !== 'normal' && BLEND_OP[l.blend]) ctx.globalCompositeOperation = BLEND_OP[l.blend];
    if (l.rotate || l.flipX || l.flipY) {
      const b = layerBox(l, fields, a);
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      if (l.rotate) ctx.rotate((l.rotate * Math.PI) / 180);
      if (l.flipX || l.flipY) ctx.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    if (l.kind === 'text') drawText(ctx, ink ? { ...l, color: ink } : l, fields, a);
    else if (l.kind === 'wordmark') {
      const m = a.marks[l.mark] ?? a.marks.wordmark;
      if (m) withFx(ctx, l.layerFx, () => layerBox(l, fields, a), 0, c => drawMark(c, m, layerBox(l, fields, a), ink ?? l.color));
    }
    else if (l.kind === 'image') withFx(ctx, l.layerFx, () => layerBox(l, fields, a), 12, c => drawImageLayer(c, l.layerFx ? { ...l, shadow: false } : l, a));
    else if (l.kind === 'qr') withFx(ctx, l.layerFx, () => layerBox(l, fields, a), 0, c => drawQr(c, l));
    else withFx(ctx, l.layerFx, () => layerBox(l, fields, a), l.stroke / 2 + 2, c => drawShape(c, l));
    ctx.restore();
  }
  ctx.restore();
}

/** The document drawn at `px` pixels wide, as a canvas — for export at full resolution. */
export function renderDocTo(doc: StoryDoc, fields: Fields, a: Assets, px: number, opts: { background?: HTMLImageElement | null; hideBound?: boolean } = {}): HTMLCanvasElement {
  const f = frameOf(doc);
  const c = document.createElement('canvas');
  c.width = Math.round(px); c.height = Math.round(px * (f.h / f.w));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(px / f.w, px / f.w);
  ctx.imageSmoothingQuality = 'high';
  renderDoc(ctx, doc, fields, a, opts);
  return c;
}

// ── Making layers ──────────────────────────────────────────────────────────

/** What a bound line is for, so a resize can lay it out by its job. */
const BIND_ROLE: Record<Bind, LayerRole> = { kicker: 'kicker', headline: 'headline', weight: 'specs', details: 'cta' };
const text = (p: Partial<TextLayer> & Pick<TextLayer, 'x' | 'y' | 'size' | 'font' | 'color'>): TextLayer => ({
  id: newLayerId(p.bind ?? 'text'), kind: 'text', text: '', align: 'left', width: 888, fit: false, spacing: 0, lineHeight: 1.15,
  upper: false, shadow: false, box: null, rotate: 0, opacity: 1, ...(p.bind ? { role: BIND_ROLE[p.bind] } : {}), ...p,
});
/** A text layer with the defaults every maker here uses — for layouts built outside this file. */
export const textLayer = text;

export const newText = (color: string): TextLayer => text({ text: 'Your text', x: 540, y: 900, size: 72, font: 'regular', color, align: 'center', width: 900 });
export const newShape = (kind: ShapeLayer['kind'], color: string): ShapeLayer => ({
  id: newLayerId(kind), kind, rotate: 0, opacity: 1, role: 'decor', color, stroke: kind === 'rect' || kind === 'circle' ? 6 : 7, fill: null, radius: 24,
  ...(kind === 'arrow' ? { x: 700, y: 1050, w: -170, h: 170, curve: 40 }
    : kind === 'line' ? { x: 340, y: 1000, w: 400, h: 0, curve: 0 }
      : { x: 390, y: 850, w: 300, h: kind === 'circle' ? 300 : 200, curve: 0 }),
});
export const newImageLayer = (photoId: string): ImageLayer => ({ id: newLayerId('image'), kind: 'image', role: 'photo', photoId, x: 600, y: 1250, w: 380, radius: 24, border: '#ffffff', shadow: true, rotate: 0, opacity: 1 });
export const newLinkPill = (label: string): TextLayer => text({ text: label, role: 'cta', x: 540, y: 760, size: 46, font: 'regular', color: '#111111', align: 'center', width: 900, box: { color: '#ffffff', radius: 28, pad: 22 } });
export const newWordmark = (color: string): MarkLayer => ({ id: newLayerId('wordmark'), kind: 'wordmark', role: 'mark', mark: 'wordmark', x: 708, y: 150, width: 300, color, autoColor: false, rotate: 0, opacity: 1 });
/** The "t" monogram, a tall narrow mark; placed top-right like the wordmark. */
export const newMonogram = (color: string): MarkLayer => ({ id: newLayerId('t'), kind: 'wordmark', role: 'mark', mark: 't', x: 930, y: 140, width: 60, color, autoColor: false, rotate: 0, opacity: 1 });

// ── The designer's elements ────────────────────────────────────────────────
// Everything lands in the middle of whichever frame it is added to.

const midY = (f: Frame, h: number) => Math.round(f.h * 0.45 - h / 2);

/** Canva's three: a heading, a subheading and a little body text. */
export const newHeading = (color: string, f: Frame = STORY_FRAME): TextLayer =>
  text({ text: 'Add a heading', x: f.w / 2, y: midY(f, 150), size: 150, font: 'condensed', color, align: 'center', width: f.w - 160, fit: true, lineHeight: 0.95 });
export const newSubheading = (color: string, f: Frame = STORY_FRAME): TextLayer =>
  text({ text: 'Add a subheading', x: f.w / 2, y: midY(f, 64), size: 64, font: 'bold', color, align: 'center', width: f.w - 160 });
export const newBody = (color: string, f: Frame = STORY_FRAME): TextLayer =>
  text({ text: 'Add a little bit of body text', x: f.w / 2, y: midY(f, 40), size: 40, font: 'light', color, align: 'center', width: Math.min(760, f.w - 160), lineHeight: 1.3 });
/** A line of text in a given font, for the Brand panel's font list. */
export const newInFont = (font: FontKey, color: string, f: Frame = STORY_FRAME): TextLayer =>
  text({ text: FONT_LABEL[font].replace(/ \(.*\)$/, ''), x: f.w / 2, y: midY(f, 96), size: 96, font, color, align: 'center', width: f.w - 160 });

/** Ready-made text combinations (Canva's "font combinations"), each a group. */
export const TEXT_STYLES: { id: string; label: string; preview: { text: string; font: FontKey; upper?: boolean; spacing?: number }; make: (color: string, f: Frame) => Layer[] }[] = [
  {
    id: 'new-in', label: 'New in', preview: { text: 'NEW IN', font: 'condensed' },
    make: (color, f) => {
      const g = newLayerId('grp'), y = midY(f, 230);
      return [
        text({ role: 'kicker', text: 'Just arrived', x: f.w / 2, y, size: 44, font: 'regular', color, align: 'center', upper: true, spacing: 0.3, group: g }),
        text({ role: 'headline', text: 'New in', x: f.w / 2, y: y + 66, size: 190, font: 'condensed', color, align: 'center', width: f.w - 160, fit: true, lineHeight: 0.92, upper: true, group: g }),
      ];
    },
  },
  {
    id: 'bridal', label: 'Bridal edit', preview: { text: 'The Bridal Edit', font: 'serif-italic' },
    make: (color, f) => {
      const g = newLayerId('grp'), y = midY(f, 170);
      return [
        text({ role: 'headline', text: 'The Bridal Edit', x: f.w / 2, y, size: 112, font: 'serif-italic', color, align: 'center', width: f.w - 160, fit: true, group: g }),
        text({ role: 'kicker', text: 'Handcrafted · one of a kind', x: f.w / 2, y: y + 140, size: 36, font: 'light', color, align: 'center', upper: true, spacing: 0.25, group: g }),
      ];
    },
  },
  {
    id: 'script', label: 'Just in (script)', preview: { text: 'Just in', font: 'script' },
    make: (color, f) => [text({ role: 'headline', text: 'Just in', x: f.w / 2, y: midY(f, 170), size: 170, font: 'script', color, align: 'center', width: f.w - 160 })],
  },
  {
    id: 'timeless', label: 'Timeless (capitals)', preview: { text: 'TIMELESS', font: 'cinzel' },
    make: (color, f) => {
      const g = newLayerId('grp'), y = midY(f, 190);
      return [
        text({ role: 'headline', text: 'Timeless', x: f.w / 2, y, size: 120, font: 'cinzel', color, align: 'center', upper: true, spacing: 0.18, width: f.w - 120, fit: true, group: g }),
        text({ role: 'kicker', text: 'Crafted to be handed down', x: f.w / 2, y: y + 150, size: 46, font: 'cormorant-italic', color, align: 'center', group: g }),
      ];
    },
  },
  {
    id: 'one-of-one', label: 'One of one', preview: { text: 'One of one.', font: 'playfair' },
    make: (color, f) => [text({ role: 'headline', text: 'One of one.', x: f.w / 2, y: midY(f, 110), size: 110, font: 'playfair', color, align: 'center', width: f.w - 160, fit: true })],
  },
  {
    id: 'sold', label: 'Sold', preview: { text: 'SOLD', font: 'montserrat-bold', upper: true },
    make: (_c, f) => [text({ role: 'badge', text: 'Sold', x: f.w / 2, y: midY(f, 90), size: 72, font: 'montserrat-bold', color: '#FFFFFF', align: 'center', upper: true, spacing: 0.2, box: { color: '#8B1E2D', radius: 60, pad: 30 } })],
  },
  {
    id: 'dm', label: 'DM to order', preview: { text: 'DM to order', font: 'montserrat' },
    make: (_c, f) => [text({ role: 'cta', text: 'DM to order →', x: f.w / 2, y: midY(f, 50), size: 48, font: 'montserrat', color: '#111111', align: 'center', box: { color: '#FFFFFF', radius: 40, pad: 24 } })],
  },
];

/** A filled shape from the library (design.ts), sized for what it is. */
export function newShapeOf(key: ShapeKey, color: string, f: Frame = STORY_FRAME): ShapeLayer {
  const [w, h] = key === 'ribbon' ? [560, 130] : key === 'tag' || key === 'pill' ? [440, 150] : key === 'speech' ? [480, 340] : key === 'arch' ? [420, 540] : key === 'gem' ? [360, 300] : [320, 320];
  return { id: newLayerId(key), kind: 'shape', role: 'decor', shape: key, x: Math.round(f.w / 2 - w / 2), y: midY(f, h), w, h, color: '#FFFFFF', stroke: 0, fill: color, curve: 0, radius: 0, rotate: 0, opacity: 1 };
}
/** A plain line in one of the dash styles. */
export const newLineStyle = (dash: 'solid' | 'dash' | 'dot', color: string, f: Frame = STORY_FRAME): ShapeLayer =>
  ({ id: newLayerId('line'), kind: 'line', role: 'decor', x: f.w / 2 - 250, y: Math.round(f.h * 0.45), w: 500, h: 0, color, stroke: dash === 'dot' ? 10 : 6, fill: null, curve: 0, radius: 0, dash, rotate: 0, opacity: 1 });

/** A photo in a frame (Canva's Frames): cut to the shape, the photo filling it. */
export function newFrame(mask: MaskKey, photoId: string, f: Frame = STORY_FRAME): ImageLayer {
  const [w, h] = mask === 'arch' ? [480, 620] : mask === 'pill' ? [420, 640] : [520, 520];
  return { id: newLayerId('frame'), kind: 'image', role: 'photo', photoId, x: Math.round(f.w / 2 - w / 2), y: midY(f, h), w, h, radius: 0, border: null, shadow: false, mask, rotate: 0, opacity: 1 };
}
/** An uploaded image (a logo, a certificate…), at most 600 wide, centred. */
export function newUploadLayer(src: string, img: HTMLImageElement, f: Frame = STORY_FRAME): ImageLayer {
  const w = Math.min(600, img.naturalWidth || 600), h = w * ratioOf(img);
  return { id: newLayerId('upload'), kind: 'image', role: 'image', photoId: '', src, x: Math.round(f.w / 2 - w / 2), y: midY(f, h), w, radius: 0, border: null, shadow: false, rotate: 0, opacity: 1 };
}

/** A QR code for a link or number, 300 wide, on white, centred. */
export function newQr(value: string, fg = '#111111', f: Frame = STORY_FRAME): QrLayer {
  const w = Math.min(300, f.w - 160);
  return { id: newLayerId('qr'), kind: 'qr', role: 'cta', x: Math.round(f.w / 2 - w / 2), y: midY(f, w), w, value, fg, bg: '#FFFFFF', quiet: 4, rotate: 0, opacity: 1 };
}

/** Starting values for the Effects panel's three toggles (shadow, glow, outline on shapes, images, marks, QR codes). */
export const FX_DEFAULTS: Required<LayerFx> = {
  shadow: { color: '#000000', x: 0, y: 12, blur: 28, alpha: 0.35 },
  glow: { color: '#FFD98A', blur: 30, alpha: 0.8 },
  outline: { color: '#FFFFFF', width: 6 },
};

/** Stickers: a shape and a word on it, grouped (Canva's badges). */
export const BADGES: { id: string; label: string; make: (accent: string, f: Frame) => Layer[] }[] = [
  {
    id: 'new', label: 'NEW burst',
    make: (accent, f) => {
      const g = newLayerId('grp');
      const s = { ...newShapeOf('burst', accent, f), group: g, role: 'badge' as const, w: 260, h: 260 };
      s.x = Math.round(f.w / 2 - 130); s.y = midY(f, 260);
      return [s, text({ role: 'badge', text: 'New', x: f.w / 2, y: s.y + 96, size: 70, font: 'condensed', color: '#FFFFFF', align: 'center', upper: true, group: g })];
    },
  },
  {
    id: 'just-in', label: 'Just in banner',
    make: (accent, f) => {
      const g = newLayerId('grp');
      const s = { ...newShapeOf('ribbon', accent, f), group: g, role: 'badge' as const };
      return [s, text({ role: 'badge', text: 'Just in', x: f.w / 2, y: s.y + 36, size: 60, font: 'bold', color: '#FFFFFF', align: 'center', upper: true, spacing: 0.15, group: g })];
    },
  },
  {
    id: 'weight-tag', label: 'Weight tag',
    make: (accent, f) => {
      const g = newLayerId('grp');
      const s = { ...newShapeOf('tag', accent, f), group: g, role: 'badge' as const };
      return [s, text({ bind: 'weight', role: 'badge', x: s.x + s.w / 2 + 20, y: s.y + 38, size: 70, font: 'light', color: '#FFFFFF', align: 'center', group: g })];
    },
  },
  {
    id: 'sparkles', label: 'Sparkles',
    make: (_a, f) => {
      const g = newLayerId('grp');
      const big = { ...newShapeOf('sparkle', '#FFFFFF', f), group: g, w: 150, h: 150 };
      big.x = Math.round(f.w / 2 - 75); big.y = midY(f, 150);
      const small = { ...newShapeOf('sparkle', '#FFFFFF', f), group: g, w: 70, h: 70, x: big.x + 150, y: big.y - 40 };
      return [big, small];
    },
  },
];

// ── The square (WhatsApp and the website) ──────────────────────────────────
// The overlay tool's geometry, as fractions of a 3000-px square: the weight in
// Futura LT Light at 143, 120 in, baseline at 100 + 143 × 1.1; the logo 580
// wide, 125 in from the bottom-right corner. Here in 1080 units.
const K = 1080 / 3000;
const STAMP_SIZE = 143 * K, STAMP_X = 120 * K, STAMP_BASELINE = (100 + 143 * 1.1) * K;
const LOGO_W = 580 * K, LOGO_PAD = 125 * K;

export const newWeightStamp = (): TextLayer => text({
  bind: 'weight', x: STAMP_X, y: STAMP_BASELINE - STAMP_SIZE * 0.82, size: Math.round(STAMP_SIZE * 10) / 10, font: 'futura',
  color: '#ffffff', autoColor: true, width: 900, spacing: 2 / 143,
});
/**
 * A mark in the bottom-right corner (or the top-right: `top`), the overlay tool's
 * inset from both edges — of the square, or of a website photo edited in its own
 * shape (1080 wide, any height). Top-right is also where Mina's catalogue puts its
 * MINA mark (brand.mjs: 19% of the width, 4.8% in, 3.7% down — within a few pixels).
 */
export function newCornerMark(mark: MarkKind, a: Assets, f: Frame = SQUARE_FRAME, top = false): MarkLayer {
  // The wordmark is the tool's 580/3000 wide; the t mark is sized to about the wordmark's height × 2.
  const width = mark === 't' ? 58 : LOGO_W;
  const img = a.marks[mark] ?? a.marks.wordmark;
  const h = width * (img && img.naturalWidth ? img.naturalHeight / img.naturalWidth : mark === 't' ? 2 : 0.25);
  return { id: newLayerId(mark), kind: 'wordmark', role: 'mark', mark, x: f.w - LOGO_PAD - width, y: top ? LOGO_PAD : f.h - LOGO_PAD - h, width, color: '#ffffff', autoColor: true, rotate: 0, opacity: 1 };
}

export type SquarePresetId = 'catalogue' | 'catalogue-top' | 'catalogue-t' | 'weight' | 'mark' | 'name' | 'clean';
export const SQUARE_PRESETS: { id: SquarePresetId; label: string }[] = [
  { id: 'catalogue', label: 'Weight + taheri wordmark' },
  { id: 'catalogue-top', label: 'Weight + wordmark, top right' },
  { id: 'catalogue-t', label: 'Weight + t mark' },
  { id: 'weight', label: 'Weight only' },
  { id: 'name', label: 'Name, weight and wordmark' },
  { id: 'clean', label: 'Clean — nothing on it' },
];

/** The square's layers as a preset lays them down. Custom layers are kept. */
export function applySquarePreset(doc: StoryDoc, preset: SquarePresetId, fields: Fields, a: Assets): StoryDoc {
  const keep = doc.layers.filter(l => !(l.kind === 'text' && l.bind) && l.kind !== 'wordmark');
  const out: Layer[] = [];
  // Measured from the bottom, so a photo edited in its own shape (taller than square) is laid out the same way.
  const f = frameOf(doc), below = f.h - 1080;
  if (preset === 'catalogue' || preset === 'catalogue-top' || preset === 'catalogue-t' || preset === 'weight') out.push(newWeightStamp());
  if (preset === 'catalogue') out.push(newCornerMark('wordmark', a, f));
  // Top right: taheri.shop's ring photos, and the MINA mark on every catalogue photo.
  if (preset === 'catalogue-top' || preset === 'mark') out.push(newCornerMark('wordmark', a, f, true));
  if (preset === 'catalogue-t') out.push(newCornerMark(a.marks.t ? 't' : 'wordmark', a, f));
  if (preset === 'name') {
    // The grid posts' look: the name in a Didone italic, the facts small beneath, bottom-left.
    const name = text({ bind: 'headline', x: 64, y: 820 + below, size: 76, font: 'serif-italic', color: '#ffffff', autoColor: true, width: 640, fit: true, lineHeight: 1 });
    out.push({ ...name, flow: { gap: 0 } });
    out.push(text({ bind: 'details', x: 64, y: 910 + below, size: 30, font: 'regular', color: '#ffffff', autoColor: true, width: 640, flow: { gap: 14 }, lineHeight: 1.25 }));
    out.push(newCornerMark('wordmark', a, f));
  }
  return reflow({ ...doc, layers: [...out, ...keep] }, fields, a);
}

export const emptySquare = (): StoryDoc => ({
  bg: { photoId: null, placement: FILL, dim: 0, gradient: 'none', color: '#EDE6DA' },
  layers: [],
  frame: SQUARE_FRAME,
  placements: {},
});

// ── Presets: the shop's story layouts ──────────────────────────────────────

export type PresetId = 'stack-left' | 'center' | 'split' | 'bottom' | 'minimal';
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'stack-left', label: 'Left stack' },
  { id: 'center', label: 'Centred' },
  { id: 'split', label: 'Split' },
  { id: 'bottom', label: 'Bottom' },
  { id: 'minimal', label: 'Headline only' },
];

/**
 * Bound layers laid out the way a preset does it, measured so they stack
 * without overlapping. Custom layers (arrows, extra text, insets) are kept.
 */
export function applyPreset(doc: StoryDoc, preset: PresetId, palette: Palette, fields: Fields, a: Assets, opts: { weightOwnLine: boolean; wordmark: boolean }): StoryDoc {
  const keep = doc.layers.filter(l => !(l.kind === 'text' && l.bind) && l.kind !== 'wordmark');
  const center = preset === 'center';
  const align: TextLayer['align'] = center ? 'center' : 'left';
  const x = center ? 540 : 96;
  const out: Layer[] = [];
  let y = preset === 'bottom' ? 1380 : opts.wordmark ? 300 : 260;
  // Stacked lines: reflow() keeps each one under the one above as the words change.
  const push = (l: TextLayer, gap: number) => {
    const stacked = { ...l, flow: { gap } };
    out.push(stacked);
    if (textOf(l, fields).trim()) y = l.y + layerBox(stacked, fields, a).h;
  };
  if (opts.wordmark) out.push(newWordmark(palette.dark ? '#FFFFFF' : '#111111'));
  push(text({ bind: 'kicker', x, y, size: 54, font: 'regular', color: palette.body, align }), 0);
  const headline = text({ bind: 'headline', x, y: y + (fields.kicker.trim() ? 6 : 0), size: preset === 'minimal' ? 230 : 210, font: 'condensed', color: palette.headline, align, width: 888, fit: true, lineHeight: 0.92 });
  push(headline, 6);
  if (preset === 'split') {
    // Headline and weight on the left; the details in a right-hand column at the headline's height.
    push(text({ bind: 'weight', x, y: y + 14, size: 84, font: 'light', color: palette.body, align }), 14);
    out.push(text({ bind: 'details', x: 984, y: headline.y + 40, size: 42, font: 'regular', color: palette.body, align: 'right', width: 420, lineHeight: 1.25 }));
  } else if (preset !== 'minimal') {
    if (opts.weightOwnLine) push(text({ bind: 'weight', x, y: y + 14, size: 92, font: 'light', color: palette.body, align }), 14);
    push(text({ bind: 'details', x, y: y + 24, size: 40, font: 'regular', color: palette.body, align, width: 888 }), 24);
  } else {
    push(text({ bind: 'weight', x, y: y + 14, size: 92, font: 'light', color: palette.body, align }), 14);
  }
  return reflow({ ...doc, layers: [...out, ...keep] }, fields, a);
}

/** Recolour the bound layers and the wordmark to a palette, leaving custom layers alone. */
export function applyPalette(doc: StoryDoc, palette: Palette): StoryDoc {
  return {
    ...doc,
    layers: doc.layers.map(l => {
      if (l.kind === 'wordmark' && !l.autoColor) return { ...l, color: palette.dark ? '#FFFFFF' : '#111111' };
      if (l.kind === 'text' && l.bind) return { ...l, color: l.bind === 'headline' ? palette.headline : palette.body };
      return l;
    }),
  };
}

export const emptyDoc = (photoId: string | null): StoryDoc => ({
  bg: { photoId, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#EDE6DA' },
  layers: [],
});
