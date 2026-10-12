/**
 * Measuring a layout and scoring it (docs/features/design-studio-plan.md §3.2): where every layer lands, where
 * the photograph's subject lands, and how many things are wrong. Pure; the same numbers decide between the
 * resize's candidates and between its plan and the AI's.
 *
 * Text is measured by the engine's own `layerBox` where there is a browser (so what is scored is what is drawn)
 * and by a character-width estimate where there is none (the tests, the server).
 */

import {
  frameOf, layerBox, layoutText, textOf,
  type Assets, type Box, type Box01, type Fields, type FontKey, type ImageLayer, type Layer, type StoryDoc, type TextLayer,
} from '@/lib/social/editor';
import { intersects } from '@/lib/social/design';
import type { Frame, Placement } from '@/lib/social/story';
import { safeBands, type SafeBands } from './safe';
import { roleOf } from './roles';

// ── Measuring ──────────────────────────────────────────────────────────────

export interface Measure {
  box(l: Layer): Box;
  /** The size a text layer is actually drawn at (a fitted line may shrink). */
  textSize(l: TextLayer): number;
}

/** Average advance of a face, in ems (lower-case); capitals run about a quarter wider. */
const EM: Record<FontKey, number> = {
  condensed: 0.38, light: 0.5, regular: 0.52, bold: 0.56, serif: 0.47, 'serif-italic': 0.43, futura: 0.52,
  cormorant: 0.42, 'cormorant-italic': 0.4, playfair: 0.5, script: 0.42, montserrat: 0.58, 'montserrat-bold': 0.62, cinzel: 0.62,
};
const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function';

const advance = (s: string, size: number, l: TextLayer) => {
  const em = EM[l.font] ?? 0.5;
  let w = 0;
  for (const ch of s) w += size * em * (ch !== ch.toLowerCase() ? 1.25 : 1) + l.spacing * size;
  return w;
};

function estimateLines(l: TextLayer, text: string, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = words[0];
    for (const w of words.slice(1)) {
      if (advance(`${line} ${w}`, size, l) <= width) line += ` ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/** A text layer's lines, size and box without a canvas: the engine's rules (wrap, fit, line height) on estimated widths. */
export function estimateText(l: TextLayer, fields: Fields): { size: number; w: number; h: number; lines: number } {
  const text = textOf(l, fields);
  let size = l.size;
  let lines = estimateLines(l, text, size, l.fit ? Infinity : l.width);
  if (l.fit && lines.length) {
    const widest = Math.max(...lines.map(s => advance(s, size, l)), 1);
    if (widest > l.width) size = Math.max(1, Math.floor(size * (l.width / widest)));
  }
  const w = Math.max(0, ...lines.map(s => advance(s, size, l)));
  const h = lines.length ? size * (l.lineHeight * (lines.length - 1) + 1) : 0;
  return { size, w, h, lines: lines.length };
}

export function makeMeasure(fields: Fields, assets: Assets): Measure {
  if (hasDom()) {
    const ctx = document.createElement('canvas').getContext('2d');
    return {
      box: l => layerBox(l, fields, assets),
      textSize: l => (ctx ? layoutText(ctx, l, fields, assets.fonts).size : estimateText(l, fields).size),
    };
  }
  return {
    box: l => {
      if (l.kind !== 'text') return layerBox(l, fields, assets);
      const e = estimateText(l, fields), pad = l.box ? l.box.pad : 0;
      const w = e.w + pad * 2, h = e.h + pad * 2;
      const x = l.align === 'left' ? l.x - pad : l.align === 'center' ? l.x - w / 2 : l.x - w + pad;
      return { x, y: l.y - pad, w: Math.max(w, 20), h: Math.max(h, 20) };
    },
    textSize: l => estimateText(l, fields).size,
  };
}

const isEmpty = (l: Layer, fields: Fields) => l.kind === 'text' && !textOf(l, fields).trim();
/** The text layers that show: not hidden, not empty. */
export const shownTexts = (doc: StoryDoc, fields: Fields): TextLayer[] =>
  doc.layers.filter((l): l is TextLayer => l.kind === 'text' && !l.hidden && !isEmpty(l, fields));

/** The layers that stack under one another (the engine's `flow`), in order. */
export const stackOf = (doc: StoryDoc): TextLayer[] => doc.layers.filter((l): l is TextLayer => l.kind === 'text' && !!l.flow && !l.hidden);

/** The engine's `reflow`, on this measure: each stacked line under the one above it, an empty line taking no room. */
export function reflowDoc(doc: StoryDoc, fields: Fields, m: Measure): StoryDoc {
  let bottom: number | null = null;
  let changed = false;
  const layers = doc.layers.map(l => {
    if (l.kind !== 'text' || !l.flow || l.hidden) return l;
    const empty = !textOf(l, fields).trim();
    const y = bottom === null ? l.y : bottom + (empty ? 0 : l.flow.gap);
    const placed = y === l.y ? l : { ...l, y };
    if (placed !== l) changed = true;
    if (!empty) bottom = y + (m.box(placed).h - (placed.box ? placed.box.pad * 2 : 0));
    else if (bottom === null) bottom = y;
    return placed;
  });
  return changed ? { ...doc, layers } : doc;
}

export const unionOf = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x)), y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w)), y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

// ── Where the photograph's subject lands ───────────────────────────────────

/** The part of the photo that matters when nothing says: its middle 60%. */
export const DEFAULT_SUBJECT: Box01 = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

/** Where a photo of this aspect (w/h) sits in a frame under a placement: the maths of `drawStoryPhoto`. */
export function photoRectIn(aspect: number, p: Placement, f: Frame): Box {
  const iw = aspect, ih = 1;
  const cover = Math.max(f.w / iw, f.h / ih), contain = Math.min(f.w / iw, f.h / ih);
  const scale = (p.mode === 'fill' ? cover : contain) * Math.max(1, p.zoom);
  const dw = iw * scale, dh = ih * scale;
  return { x: dw > f.w ? -(dw - f.w) * p.focusX : (f.w - dw) * p.focusX, y: dh > f.h ? -(dh - f.h) * p.focusY : (f.h - dh) * p.focusY, w: dw, h: dh };
}

/** Where a photo of this aspect sits inside a picture frame of the engine's: cropped to fill it. */
export function layerPhotoRect(aspect: number, l: Pick<ImageLayer, 'fx' | 'fy' | 'iz'>, box: Box): Box {
  const s = Math.max(box.w / aspect, box.h / 1) * Math.max(1, l.iz ?? 1);
  const dw = aspect * s, dh = s;
  return { x: box.x - (dw - box.w) * (l.fx ?? 0.5), y: box.y - (dh - box.h) * (l.fy ?? 0.5), w: dw, h: dh };
}

const sub = (r: Box, s: Box01): Box => ({ x: r.x + s.x * r.w, y: r.y + s.y * r.h, w: s.w * r.w, h: s.h * r.h });
const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const overlap = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

export function photoAspectOf(doc: StoryDoc, assets: Assets, fallback = 1): number {
  const id = doc.bg.photoId;
  const img = id ? assets.photos?.[id] : undefined;
  if (img && img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
  return fallback;
}

/** The subject, in frame units, and how much of it shows; null when no photograph is on show. */
export function subjectInFrame(doc: StoryDoc, assets: Assets, subject: Box01, fallbackAspect = 1): { rect: Box; visible: number } | null {
  const f = frameOf(doc);
  const aspect = photoAspectOf(doc, assets, fallbackAspect);
  // The photograph is the ground, or (when the ground is plain) the picture layer that shows it.
  const panel = doc.bg.photoId ? undefined : doc.layers.find((l): l is ImageLayer => l.kind === 'image' && !l.hidden && roleOf(l, doc) === 'photo');
  let rect: Box | null = null, window: Box = { x: 0, y: 0, w: f.w, h: f.h };
  const pl = doc.placements ? (doc.bg.photoId ? doc.placements[doc.bg.photoId] : undefined) : doc.bg.placement;
  if (panel) {
    const img = assets.photos?.[panel.photoId];
    const a = img && img.naturalWidth ? img.naturalWidth / img.naturalHeight : fallbackAspect;
    const h = panel.h ?? panel.w / a;
    window = { x: panel.x, y: panel.y, w: panel.w, h };
    rect = sub(layerPhotoRect(a, panel, window), subject);
  } else if (doc.bg.photoId) {
    const p = pl ?? doc.bg.placement ?? { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 };
    rect = sub(photoRectIn(aspect, p, f), subject);
  }
  if (!rect) return null;
  const a = area(rect);
  return { rect, visible: a ? overlap(rect, window) / a : 1 };
}

// ── Scoring ────────────────────────────────────────────────────────────────

export interface ScoreItem { id: string; points: number; why: string }
export interface Score { score: number; penalties: ScoreItem[]; bonuses: ScoreItem[] }
export interface ScoreOptions { subject?: Box01; photoAspect?: number; measure?: Measure; bands?: SafeBands }

/** The smallest text a frame can carry: 3% of its short side, but never asking for more than 28 px. */
export const minTextSize = (f: Frame) => Math.min(0.03 * Math.min(f.w, f.h), 28);

export const BASE_SCORE = 90;

export function scoreLayout(input: StoryDoc, fields: Fields, assets: Assets, o: ScoreOptions = {}): Score {
  const m = o.measure ?? makeMeasure(fields, assets);
  const doc = reflowDoc(input, fields, m);
  const f = frameOf(doc);
  const bands = o.bands ?? safeBands(f);
  const penalties: ScoreItem[] = [], bonuses: ScoreItem[] = [];
  const texts = shownTexts(doc, fields);
  const boxes = new Map(texts.map(l => [l.id, m.box(l)] as const));

  // Any text outside the frame or the safe bands.
  const out = texts.filter(l => {
    const b = boxes.get(l.id)!;
    return b.x < -0.5 || b.y < bands.top - 0.5 || b.x + b.w > f.w - bands.right + 0.5 || b.y + b.h > f.h - bands.bottom + 0.5;
  });
  if (out.length) penalties.push({ id: 'outside', points: 40, why: `${out.length} text ${out.length === 1 ? 'box' : 'boxes'} outside the frame or the safe bands` });

  // Text boxes on top of one another.
  let overlaps = 0;
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = boxes.get(texts[i].id)!, b = boxes.get(texts[j].id)!;
    const sh = (r: Box): Box => ({ x: r.x + 3, y: r.y + 3, w: Math.max(0, r.w - 6), h: Math.max(0, r.h - 6) });
    if (intersects(sh(a), sh(b))) overlaps++;
  }
  if (overlaps) penalties.push({ id: 'overlap', points: 25, why: `${overlaps} pair${overlaps === 1 ? '' : 's'} of text boxes overlap` });

  // Text too small to read.
  const floor = minTextSize(f);
  const small = texts.filter(l => m.textSize(l) < floor - 0.5);
  if (small.length) penalties.push({ id: 'small', points: 20, why: `${small.length} line${small.length === 1 ? '' : 's'} under ${Math.round(floor)} px` });

  // The mark on the subject, the subject cut.
  // Where the piece is is only a guess unless someone said; a guess convicts a mark only when it is mostly on it.
  const known = o.subject ?? doc.meta?.subject;
  const subj = subjectInFrame(doc, assets, known ?? DEFAULT_SUBJECT, o.photoAspect ?? 1);
  if (subj) {
    const marks = doc.layers.filter(l => l.kind === 'wordmark' && !l.hidden);
    if (marks.some(l => { const b = m.box(l); return overlap(b, subj.rect) > (known ? 0.05 : 0.5) * area(b); })) penalties.push({ id: 'mark', points: 15, why: 'the mark sits on the piece' });
    if (subj.visible < 0.92) penalties.push({ id: 'cropped', points: 10, why: `${Math.round((1 - subj.visible) * 100)}% of the piece is cropped` });
  }

  // Order: the stack lined up inside the margins, the call to action last.
  const stack = stackOf(doc).filter(l => !isEmpty(l, fields));
  if (stack.length) {
    const sb = stack.map(l => m.box(l));
    const edge = (g: (b: Box) => number) => Math.max(...sb.map(g)) - Math.min(...sb.map(g)) <= 2;
    const lined = edge(b => b.x) || edge(b => b.x + b.w) || edge(b => b.x + b.w / 2);
    const inside = sb.every(b => b.x >= f.w * 0.02 && b.x + b.w <= f.w * 0.98);
    if (lined && inside) bonuses.push({ id: 'aligned', points: 5, why: 'the words are lined up inside the margins' });
  }
  const cta = texts.find(l => roleOf(l, doc) === 'cta');
  if (cta && texts.every(l => l === cta || boxes.get(l.id)!.y + boxes.get(l.id)!.h <= boxes.get(cta.id)!.y + boxes.get(cta.id)!.h + 2)) bonuses.push({ id: 'cta', points: 5, why: 'the call to action is last' });

  const raw = BASE_SCORE - penalties.reduce((n, p) => n + p.points, 0) + bonuses.reduce((n, p) => n + p.points, 0);
  return { score: Math.max(0, Math.min(100, raw)), penalties, bonuses };
}
