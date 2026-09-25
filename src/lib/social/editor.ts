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

export type FontKey = 'condensed' | 'light' | 'regular' | 'bold' | 'serif' | 'serif-italic' | 'futura';
export type Bind = 'kicker' | 'headline' | 'weight' | 'details';

interface Base { id: string; rotate: number; opacity: number; hidden?: boolean }
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
}
/**
 * The shop's mark: the Didone wordmark image, or the catalogue stamp — the
 * two spaced lines ("TAHERI / COLLECTIONS") the overlay tool puts in the
 * corner of every catalogue photo, drawn as text so it stays sharp at any size.
 */
export interface MarkLayer extends Base { kind: 'wordmark'; mark?: 'wordmark' | 'stamp'; x: number; y: number; width: number; tone: 'dark' | 'light' | 'auto' }
export interface ShapeLayer extends Base {
  kind: 'arrow' | 'line' | 'rect' | 'circle';
  /** For arrow/line: from (x, y) to (x + w, y + h). For rect/circle: the box. */
  x: number; y: number; w: number; h: number;
  color: string; stroke: number;
  fill: string | null;
  /** Arrows and lines bow by this much (px, perpendicular), like a hand-drawn stroke. */
  curve: number;
  radius: number;
}
export interface ImageLayer extends Base { kind: 'image'; photoId: string; x: number; y: number; w: number; radius: number; border: string | null; shadow: boolean }
export type Layer = TextLayer | MarkLayer | ShapeLayer | ImageLayer;

export interface StoryDoc {
  bg: { photoId: string | null; placement: Placement; dim: number; gradient: 'none' | 'top' | 'bottom' | 'both'; color: string };
  layers: Layer[];
  /** Size in its own units: the story is 1080 × 1920 (the default), the square 1080 × 1080. */
  frame?: Frame;
  /**
   * The square carries one set of layers for every photo it is used on, but a
   * crop per photo: each photo's placement lives here, keyed by its id.
   */
  placements?: Record<string, Placement>;
}

export const SQUARE_FRAME: Frame = { w: 1080, h: 1080 };
export const frameOf = (d: StoryDoc): Frame => d.frame ?? STORY_FRAME;
const FILL: Placement = { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 };
/** The placement of the photo on show — per photo when the document keeps them. */
export const placementOf = (d: StoryDoc): Placement =>
  d.placements ? (d.bg.photoId ? d.placements[d.bg.photoId] : undefined) ?? FILL : d.bg.placement;
export const withPlacement = (d: StoryDoc, p: Placement): StoryDoc =>
  d.placements && d.bg.photoId ? { ...d, placements: { ...d.placements, [d.bg.photoId]: p } } : { ...d, bg: { ...d.bg, placement: p } };

export interface FontFamilies { headline: string; body: string; serif: string }
export interface Assets {
  photos: Record<string, HTMLImageElement>;
  wordmark: { dark: HTMLImageElement; light: HTMLImageElement } | null;
  fonts: FontFamilies;
  /** The catalogue stamp's two lines, this house's ("TAHERI", "COLLECTIONS"). */
  stamp: [string, string];
}
export type Fields = Record<Bind, string>;

export const newLayerId = (k: string) => `${k}-${Math.random().toString(36).slice(2, 8)}`;

// ── Fonts ──────────────────────────────────────────────────────────────────

export const FONT_LABEL: Record<FontKey, string> = {
  condensed: 'Condensed (headline)', light: 'Light', regular: 'Regular', bold: 'Bold',
  serif: 'Didone', 'serif-italic': 'Didone italic', futura: 'Futura (stamp)',
};

export function fontCss(font: FontKey, size: number, f: FontFamilies): string {
  switch (font) {
    case 'condensed': return `800 ${size}px ${f.headline}`;
    case 'light': return `300 ${size}px ${f.body}`;
    case 'regular': return `400 ${size}px ${f.body}`;
    case 'bold': return `700 ${size}px ${f.body}`;
    case 'serif': return `500 ${size}px ${f.serif}`;
    case 'serif-italic': return `italic 400 ${size}px ${f.serif}`;
    case 'futura': return `300 ${size}px "Taheri Stamp", Futura, "Century Gothic", sans-serif`;
  }
}

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

export interface TextLayout { lines: string[]; size: number; widths: number[]; w: number; h: number }

/** Lines, the size actually used, and the box they make. */
export function layoutText(ctx: Ctx, l: TextLayer, fields: Fields, fonts: FontFamilies): TextLayout {
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

// ── Bounds and hit-testing ─────────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number }

let measureCtx: Ctx | null = null;
const mctx = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

export function layerBox(l: Layer, fields: Fields, a: Assets): Box {
  switch (l.kind) {
    case 'text': {
      const t = layoutText(mctx(), l, fields, a.fonts);
      const pad = l.box ? l.box.pad : 0;
      const w = t.w + pad * 2, h = t.h + pad * 2;
      const x = l.align === 'left' ? l.x - pad : l.align === 'center' ? l.x - w / 2 : l.x - w + pad;
      return { x, y: l.y - pad, w: Math.max(w, 20), h: Math.max(h, 20) };
    }
    case 'wordmark': {
      if (l.mark === 'stamp') return { x: l.x, y: l.y, w: l.width, h: stampLayout(mctx(), l.width, a).h };
      const m = a.wordmark?.dark;
      const h = l.width * (m && m.naturalWidth ? m.naturalHeight / m.naturalWidth : 0.25);
      return { x: l.x, y: l.y, w: l.width, h };
    }
    case 'image': {
      const img = a.photos[l.photoId];
      const h = img && img.naturalWidth ? l.w * (img.naturalHeight / img.naturalWidth) : l.w;
      return { x: l.x, y: l.y, w: l.w, h };
    }
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
    case 'image': return { ...l, w: c(Math.round(l.w * k), 80, 1080) };
    default: return { ...l, w: Math.round(l.w * k), h: Math.round(l.h * k), stroke: c(Math.round(l.stroke * Math.sqrt(k)), 1, 60) };
  }
}

// ── Drawing ────────────────────────────────────────────────────────────────

function drawText(ctx: Ctx, l: TextLayer, fields: Fields, a: Assets) {
  const t = layoutText(ctx, l, fields, a.fonts);
  if (!t.lines.length || !t.lines.some(Boolean)) return;
  ctx.textBaseline = 'alphabetic';
  if (l.box) {
    const b = layerBox(l, fields, a);
    ctx.save();
    ctx.fillStyle = l.box.color;
    roundRect(ctx, b.x, b.y, b.w, b.h, l.box.radius);
    ctx.fill();
    ctx.restore();
  }
  ctx.font = fontCss(l.font, t.size, a.fonts);
  setSpacing(ctx, l.spacing * t.size);
  ctx.fillStyle = l.color;
  ctx.textAlign = l.align;
  if (l.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = t.size * 0.18; ctx.shadowOffsetY = t.size * 0.04; }
  // First baseline sits about 0.82 of the size below the top for these faces.
  t.lines.forEach((line, i) => ctx.fillText(line, l.x, l.y + t.size * 0.82 + i * t.size * l.lineHeight));
  ctx.shadowColor = 'transparent';
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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (l.kind === 'rect' || l.kind === 'circle') {
    const x = Math.min(l.x, l.x + l.w), y = Math.min(l.y, l.y + l.h), w = Math.abs(l.w), h = Math.abs(l.h);
    ctx.beginPath();
    if (l.kind === 'rect') roundRect(ctx, x, y, w, h, l.radius);
    else ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    if (l.fill) { ctx.fillStyle = l.fill; ctx.fill(); }
    if (l.stroke > 0) ctx.stroke();
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

function drawImageLayer(ctx: Ctx, l: ImageLayer, a: Assets) {
  const img = a.photos[l.photoId];
  if (!img) return;
  const h = l.w * (img.naturalHeight / img.naturalWidth);
  ctx.save();
  if (l.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 10; }
  if (l.border) { ctx.fillStyle = l.border; roundRect(ctx, l.x - 8, l.y - 8, l.w + 16, h + 16, l.radius + 8); ctx.fill(); }
  ctx.shadowColor = 'transparent';
  roundRect(ctx, l.x, l.y, l.w, h, l.radius);
  ctx.clip();
  ctx.drawImage(img, l.x, l.y, l.w, h);
  ctx.restore();
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
}

// ── The catalogue stamp and automatic colour ───────────────────────────────

/** The stamp's two lines sized to the same width: a wide spaced top line, a finer one under it. */
function stampLayout(ctx: Ctx, width: number, a: Assets) {
  const [top, bottom] = a.stamp;
  const fit = (text: string, weight: number, spacing: number) => {
    ctx.font = `${weight} 100px ${a.fonts.body}`;
    setSpacing(ctx, spacing * 100);
    // Letter spacing trails the last letter; leave it out of the width so both lines end flush.
    const w = Math.max(1, ctx.measureText(text).width - spacing * 100);
    return (width / w) * 100;
  };
  const s1 = fit(top, 400, 0.32);
  // A one-line mark (the second line left empty) is just the first line.
  if (!bottom) return { s1, s2: 0, gap: 0, h: s1 * 0.74 };
  const s2 = fit(bottom, 300, 0.2);
  const gap = s1 * 0.18;
  return { s1, s2, gap, h: s1 * 0.74 + gap + s2 * 0.74 };
}

function drawStamp(ctx: Ctx, l: MarkLayer, a: Assets, colour: string) {
  const t = stampLayout(ctx, l.width, a);
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${t.s1}px ${a.fonts.body}`;
  setSpacing(ctx, 0.32 * t.s1);
  ctx.fillText(a.stamp[0], l.x, l.y + t.s1 * 0.74);
  if (!a.stamp[1]) return;
  ctx.font = `300 ${t.s2}px ${a.fonts.body}`;
  setSpacing(ctx, 0.2 * t.s2);
  ctx.fillText(a.stamp[1], l.x, l.y + t.s1 * 0.74 + t.gap + t.s2 * 0.74);
}

/**
 * White or the tool's near-black, whichever reads over what is already drawn
 * under this box. Reads the pixels through the current transform, so it works
 * on the preview and on a 3000-px export alike.
 */
function autoInk(ctx: Ctx, b: Box): string {
  try {
    const m = ctx.getTransform();
    const x = Math.max(0, Math.round(m.a * b.x + m.e)), y = Math.max(0, Math.round(m.d * b.y + m.f));
    const w = Math.max(1, Math.round(m.a * b.w)), h = Math.max(1, Math.round(m.d * b.h));
    const d = ctx.getImageData(x, y, Math.min(w, ctx.canvas.width - x), Math.min(h, ctx.canvas.height - y)).data;
    let sum = 0, n = 0;
    for (let i = 0; i < d.length; i += 64) { sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return n && sum / n > 170 ? '#1a1a1a' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

export function renderDoc(ctx: Ctx, doc: StoryDoc, fields: Fields, a: Assets, opts: { background?: HTMLImageElement | null; hideBound?: boolean } = {}) {
  const f = frameOf(doc);
  ctx.save();
  ctx.clearRect(0, 0, f.w, f.h);
  ctx.fillStyle = doc.bg.color;
  ctx.fillRect(0, 0, f.w, f.h);
  const photo = opts.background ?? (doc.bg.photoId ? a.photos[doc.bg.photoId] : null);
  if (photo) drawStoryPhoto(ctx, photo, opts.background ? FILL : placementOf(doc), f);
  if (!opts.background) drawOverlay(ctx, doc.bg, f);
  for (const l of doc.layers) {
    if (l.hidden || (opts.hideBound && l.kind === 'text' && l.bind)) continue;
    ctx.save();
    // Automatic ink is decided from what is under the layer, before it is drawn or turned.
    const ink = (l.kind === 'text' && l.autoColor) || (l.kind === 'wordmark' && l.tone === 'auto') ? autoInk(ctx, layerBox(l, fields, a)) : null;
    ctx.globalAlpha = l.opacity;
    if (l.rotate) {
      const b = layerBox(l, fields, a);
      ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
      ctx.rotate((l.rotate * Math.PI) / 180);
      ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
    }
    if (l.kind === 'text') drawText(ctx, ink ? { ...l, color: ink } : l, fields, a);
    else if (l.kind === 'wordmark' && l.mark === 'stamp') drawStamp(ctx, l, a, ink ?? (l.tone === 'dark' ? '#1a1a1a' : '#ffffff'));
    else if (l.kind === 'wordmark') {
      const tone = ink ? (ink === '#ffffff' ? 'light' : 'dark') : l.tone === 'auto' ? 'dark' : l.tone;
      const m = a.wordmark?.[tone];
      const b = layerBox(l, fields, a);
      if (m) ctx.drawImage(m, b.x, b.y, b.w, b.h);
    }
    else if (l.kind === 'image') drawImageLayer(ctx, l, a);
    else drawShape(ctx, l);
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

const text = (p: Partial<TextLayer> & Pick<TextLayer, 'x' | 'y' | 'size' | 'font' | 'color'>): TextLayer => ({
  id: newLayerId(p.bind ?? 'text'), kind: 'text', text: '', align: 'left', width: 888, fit: false, spacing: 0, lineHeight: 1.15,
  upper: false, shadow: false, box: null, rotate: 0, opacity: 1, ...p,
});

export const newText = (color: string): TextLayer => text({ text: 'Your text', x: 540, y: 900, size: 72, font: 'regular', color, align: 'center', width: 900 });
export const newShape = (kind: ShapeLayer['kind'], color: string): ShapeLayer => ({
  id: newLayerId(kind), kind, rotate: 0, opacity: 1, color, stroke: kind === 'rect' || kind === 'circle' ? 6 : 7, fill: null, radius: 24,
  ...(kind === 'arrow' ? { x: 700, y: 1050, w: -170, h: 170, curve: 40 }
    : kind === 'line' ? { x: 340, y: 1000, w: 400, h: 0, curve: 0 }
      : { x: 390, y: 850, w: 300, h: kind === 'circle' ? 300 : 200, curve: 0 }),
});
export const newImageLayer = (photoId: string): ImageLayer => ({ id: newLayerId('image'), kind: 'image', photoId, x: 600, y: 1250, w: 380, radius: 24, border: '#ffffff', shadow: true, rotate: 0, opacity: 1 });
export const newLinkPill = (label: string): TextLayer => text({ text: label, x: 540, y: 760, size: 46, font: 'regular', color: '#111111', align: 'center', width: 900, box: { color: '#ffffff', radius: 28, pad: 22 } });
export const newWordmark = (dark: boolean): MarkLayer => ({ id: newLayerId('wordmark'), kind: 'wordmark', mark: 'wordmark', x: 708, y: 150, width: 300, tone: dark ? 'light' : 'dark', rotate: 0, opacity: 1 });

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
export function newStampMark(a: Assets): MarkLayer {
  const h = stampLayout(mctx(), LOGO_W, a).h;
  return { id: newLayerId('stamp'), kind: 'wordmark', mark: 'stamp', x: 1080 - LOGO_PAD - LOGO_W, y: 1080 - LOGO_PAD - h, width: LOGO_W, tone: 'auto', rotate: 0, opacity: 1 };
}

export type SquarePresetId = 'catalogue' | 'weight' | 'name' | 'clean';
export const SQUARE_PRESETS: { id: SquarePresetId; label: string }[] = [
  { id: 'catalogue', label: 'Catalogue stamp (weight + logo)' },
  { id: 'weight', label: 'Weight only' },
  { id: 'name', label: 'Name, weight and logo' },
  { id: 'clean', label: 'Clean — nothing on it' },
];

/** The square's layers as a preset lays them down. Custom layers are kept. */
export function applySquarePreset(doc: StoryDoc, preset: SquarePresetId, fields: Fields, a: Assets): StoryDoc {
  const keep = doc.layers.filter(l => !(l.kind === 'text' && l.bind) && l.kind !== 'wordmark');
  const out: Layer[] = [];
  if (preset === 'catalogue' || preset === 'weight') out.push(newWeightStamp());
  if (preset === 'catalogue') out.push(newStampMark(a));
  if (preset === 'name') {
    // The grid posts' look: the name in a Didone italic, the facts small beneath, bottom-left.
    const name = text({ bind: 'headline', x: 64, y: 820, size: 76, font: 'serif-italic', color: '#ffffff', autoColor: true, width: 640, fit: true, lineHeight: 1 });
    out.push({ ...name, flow: { gap: 0 } });
    out.push(text({ bind: 'details', x: 64, y: 910, size: 30, font: 'regular', color: '#ffffff', autoColor: true, width: 640, flow: { gap: 14 }, lineHeight: 1.25 }));
    out.push(newStampMark(a));
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
  if (opts.wordmark) out.push(newWordmark(palette.dark));
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
      if (l.kind === 'wordmark') return { ...l, tone: palette.dark ? 'light' : 'dark' };
      if (l.kind === 'text' && l.bind) return { ...l, color: l.bind === 'headline' ? palette.headline : palette.body };
      return l;
    }),
  };
}

export const emptyDoc = (photoId: string | null): StoryDoc => ({
  bg: { photoId, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: '#EDE6DA' },
  layers: [],
});
