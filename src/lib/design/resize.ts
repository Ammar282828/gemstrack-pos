/**
 * Resize: one design into any other shape (docs/features/design-studio-plan.md §3.2). Pure, no DOM of its own
 * (text is measured by `score.ts`: the engine's `layerBox` in a browser, an estimate in node), no AI.
 *
 *   1. roles — `roles.ts` says what each layer is for.
 *   2. three candidate re-layouts, scored, the best wins:
 *        template     the design's ad template laid again on the new frame, the owner's own layers carried over;
 *        anchor       every layer keeps its corner (or middle) and its margin, the words stay one stack, a wide
 *                     target splits into a photo panel and a text column;
 *        safe         the anchor layout with every line brought inside the frame and the story's safe bands, and
 *                     text under the legible minimum raised.
 *      The photograph is only ever re-framed (its crop and focus, never its pixels): `fitSubject` keeps the piece in
 *      view, and when it cannot, says `needsExtend` and shows the whole photo on its blurred light.
 *
 * Idempotence: margins are fractions of the short side and sizes follow the area, so 4:5 → 9:16 → 4:5 lands where it
 * began (apart from words the story's safe bands moved).
 */

import { AD_TEMPLATES, applyAdTemplate, isAdFormat, type AdFormat, type AdTemplateId, type RateBoard } from '@/lib/ads/studio/templates';
import { VISUAL } from '@/lib/ads/studio/brand';
import {
  frameOf, textOf, withPlacement,
  type Assets, type Box, type Box01, type Fields, type ImageLayer, type Layer, type LayerFx, type MarkLayer, type QrLayer, type ShapeLayer, type StoryDoc, type TextLayer,
} from '@/lib/social/editor';
import type { Frame, Placement } from '@/lib/social/story';
import type { DesignPage } from './model';
import { anchorAxes, rolesOf, roleOf, TEMPLATE_LAYER, TEMPLATE_PHOTO } from './roles';
import { QR_MIN, safeBands, type SafeBands } from './safe';
import {
  DEFAULT_SUBJECT, makeMeasure, minTextSize, photoAspectOf, reflowDoc, scoreLayout, shownTexts, stackOf, subjectInFrame, unionOf,
  type Measure, type ScoreItem,
} from './score';

export { DEFAULT_SUBJECT };

export type Strategy = 'template' | 'anchor' | 'safe' | 'ai';

export interface ResizeOptions {
  /** Where the piece is in the photograph, 0…1; else the document's `meta.subject`, else its middle 60%. */
  subject?: Box01;
  /** Width / height of the photograph, when the assets can't say. */
  photoAspect?: number;
  /** Today's rates, for the rate template. */
  rates?: RateBoard | null;
  photoMarked?: boolean;
  measure?: Measure;
}

export interface ResizeResult {
  frame: Frame;
  doc: StoryDoc;
  score: number;
  strategy: Strategy;
  /** The piece cannot fill this shape without more photograph: offer "Extend the photo" (never done silently). */
  needsExtend: boolean;
  notes: string[];
  penalties: ScoreItem[];
  candidates: { strategy: Strategy; score: number }[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sameFrame = (a: Frame, b: Frame) => Math.abs(a.w - b.w) < 1 && Math.abs(a.h - b.h) < 1;

// ── The photograph ─────────────────────────────────────────────────────────

export interface SubjectFit { placement: Placement; needsExtend: boolean; padded: boolean }

/**
 * Where to put a photo of this aspect (w/h) in a frame so the subject box (0…1 of the photo) stays whole, with at
 * least 6% of it around it. When it can't (a square piece in 21:9), the photo is shown whole on its blurred light and
 * `needsExtend` is true.
 */
export function fitSubject(aspect: number, subject: Box01, frame: Frame, zoom = 1): SubjectFit {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const cover = Math.max(frame.w / a, frame.h);
  const vx = frame.w / (a * cover), vy = frame.h / cover;
  const grow = (s: Box01, k: number): Box01 => {
    const x = Math.max(0, s.x - s.w * k), y = Math.max(0, s.y - s.h * k);
    return { x, y, w: Math.min(1, s.x + s.w * (1 + k)) - x, h: Math.min(1, s.y + s.h * (1 + k)) - y };
  };
  // The share of the box that shows: all of it, or (for `slack`) enough that the cut is no more than 8% of the piece.
  const tryFill = (p: Box01, slack = false): Placement | null => {
    const share = Math.min(1, vx / p.w) * Math.min(1, vy / p.h);
    if (share < (slack ? 0.92 : 1) - 1e-6) return null;
    const z = share < 1 ? 1 : clamp(zoom, 1, Math.max(1, Math.min(vx / p.w, vy / p.h)));
    const wx = vx / z, wy = vy / z;
    const left = clamp(subject.x + subject.w / 2 - wx / 2, 0, 1 - wx), top = clamp(subject.y + subject.h / 2 - wy / 2, 0, 1 - wy);
    return { mode: 'fill', zoom: Math.round(z * 1000) / 1000, focusX: 1 - wx > 1e-6 ? left / (1 - wx) : 0.5, focusY: 1 - wy > 1e-6 ? top / (1 - wy) : 0.5 };
  };
  const padded = tryFill(grow(subject, 0.06));
  if (padded) return { placement: padded, needsExtend: false, padded: true };
  const bare = tryFill(subject, true);
  if (bare) return { placement: bare, needsExtend: false, padded: false };
  return { placement: { mode: 'fit', zoom: 1, focusX: 0.5, focusY: 0.5 }, needsExtend: true, padded: false };
}

/** An image layer's crop for its own box: the same maths, as the engine's `fx`, `fy` and `iz`. */
function layerCrop(aspect: number, subject: Box01, box: { w: number; h: number }): { fx: number; fy: number; iz: number; needsExtend: boolean } {
  const r = fitSubject(aspect, subject, { w: box.w, h: box.h });
  if (r.placement.mode === 'fill') return { fx: r.placement.focusX, fy: r.placement.focusY, iz: r.placement.zoom, needsExtend: false };
  // A frame can't show the whole photo: centre the piece as well as it goes.
  return { fx: clamp(subject.x + subject.w / 2, 0, 1), fy: clamp(subject.y + subject.h / 2, 0, 1), iz: 1, needsExtend: true };
}

const aspectOfPhoto = (id: string, assets: Assets, fallback: number) => {
  const img = assets.photos?.[id];
  return img && img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : fallback;
};

/** A layer's shadow, glow and outline grow and shrink with the layer. */
function scaleFx(fx: LayerFx | undefined, k: number): LayerFx | undefined {
  if (!fx) return fx;
  const r = (n: number) => Math.round(n * k * 10) / 10;
  return {
    ...(fx.shadow ? { shadow: { ...fx.shadow, x: r(fx.shadow.x), y: r(fx.shadow.y), blur: r(fx.shadow.blur) } } : {}),
    ...(fx.glow ? { glow: { ...fx.glow, blur: r(fx.glow.blur) } } : {}),
    ...(fx.outline ? { outline: { ...fx.outline, width: Math.max(1, r(fx.outline.width)) } } : {}),
  };
}

/** A QR code's side on a frame: scaled like a picture, never below what a phone can scan, never over half the short side. */
const qrSide = (w: number, s: number, f: Frame) => clamp(Math.round(w * s), QR_MIN, Math.max(QR_MIN, Math.floor(Math.min(f.w, f.h) * 0.5)));

// ── The anchor-preserving re-layout (strategies 2 and 3) ───────────────────

interface Ctx { fields: Fields; assets: Assets; m: Measure; subject: Box01; photoAspect: number }

function scaleText(l: TextLayer, k: number, sf: Frame, region: Box): TextLayer {
  const width = clamp(Math.round((l.width / sf.w) * region.w), 80, 2400);
  return {
    ...l,
    size: clamp(Math.round(l.size * k), 12, 600),
    width,
    ...(l.flow ? { flow: { gap: Math.round(l.flow.gap * k) } } : {}),
    box: l.box ? { ...l.box, pad: Math.round(l.box.pad * k), radius: Math.round(l.box.radius * k) } : null,
  };
}

/** Where a box of the new size goes: the corner or middle it was nearest, at the same margin (as a share of the short side). */
function place(b0: Box, b1: Box, sf: Frame, region: Box): { x: number; y: number } {
  const ax = anchorAxes(b0, sf);
  const minS = Math.min(sf.w, sf.h), minT = Math.min(region.w, region.h);
  const x = ax.x === 'l' ? region.x + (b0.x / minS) * minT
    : ax.x === 'r' ? region.x + region.w - ((sf.w - (b0.x + b0.w)) / minS) * minT - b1.w
    : region.x + ((b0.x + b0.w / 2) / sf.w) * region.w - b1.w / 2;
  const y = ax.y === 't' ? region.y + (b0.y / minS) * minT
    : ax.y === 'b' ? region.y + region.h - ((sf.h - (b0.y + b0.h)) / minS) * minT - b1.h
    : region.y + ((b0.y + b0.h / 2) / sf.h) * region.h - b1.h / 2;
  return { x, y };
}

const lum = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

let seq = 0;
const newId = (k: string) => `${k}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const shiftText = (l: TextLayer, dx: number, dy: number): TextLayer => ({ ...l, x: Math.round(l.x + dx), y: Math.round(l.y + dy) });

// ── Words that would land on one another ───────────────────────────────────

interface Item { ids: string[]; box: Box }

/** The stack as one item, every other line on its own. */
function itemsOf(doc: StoryDoc, fields: Fields, m: Measure): Item[] {
  const stackIds = new Set(stackOf(doc).map(l => l.id));
  const shown = shownTexts(doc, fields);
  const stack = shown.filter(l => stackIds.has(l.id));
  const out: Item[] = [];
  const u = unionOf(stack.map(l => m.box(l)));
  if (u) out.push({ ids: stack.map(l => l.id), box: u });
  for (const l of shown) if (!stackIds.has(l.id)) out.push({ ids: [l.id], box: m.box(l) });
  return out;
}

const GAP = 14;
const touches = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 3 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 3;
const xOverlap = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 3;

function shiftIds(doc: StoryDoc, ids: string[], dy: number): StoryDoc {
  const set = new Set(ids);
  return { ...doc, layers: doc.layers.map(l => (l.kind === 'text' && set.has(l.id) ? shiftText(l, 0, dy) : l)) };
}

/**
 * Lines of words that now overlap are pulled apart in their reading order (the lower one moves down), and, given the
 * room they must stay in, pushed back up from the bottom. The stack counts as one line of words.
 */
export function settle(input: StoryDoc, fields: Fields, m: Measure, room?: Box): StoryDoc {
  let doc = reflowDoc(input, fields, m);
  for (let pass = 0; pass < 4; pass++) {
    const its = itemsOf(doc, fields, m).sort((a, b) => a.box.y - b.box.y);
    let moved = false;
    for (let i = 1; i < its.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!touches(its[i].box, its[j].box)) continue;
        const dy = its[j].box.y + its[j].box.h + GAP - its[i].box.y;
        if (dy > 0) { doc = shiftIds(doc, its[i].ids, dy); its[i] = { ...its[i], box: { ...its[i].box, y: its[i].box.y + dy } }; moved = true; }
      }
    }
    doc = reflowDoc(doc, fields, m);
    if (!moved) break;
  }
  if (room) {
    const its = itemsOf(doc, fields, m).sort((a, b) => b.box.y - a.box.y);
    for (let i = 0; i < its.length; i++) {
      let limit = room.y + room.h;
      for (let k = 0; k < i; k++) if (xOverlap(its[i].box, its[k].box)) limit = Math.min(limit, its[k].box.y - GAP);
      const over = its[i].box.y + its[i].box.h - limit;
      if (over > 0.5) { doc = shiftIds(doc, its[i].ids, -over); its[i] = { ...its[i], box: { ...its[i].box, y: its[i].box.y - over } }; }
    }
    doc = reflowDoc(doc, fields, m);
  }
  return doc;
}

interface Relaid { doc: StoryDoc; needsExtend: boolean; panel: boolean }

/**
 * Every layer keeps its anchor and margin; the words stay one stack. `layersOnly` returns just the moved layers
 * (the template path carries the owner's own layers over this way) and leaves the background alone.
 */
function relay(src0: StoryDoc, tf: Frame, c: Ctx, o: { layersOnly?: boolean } = {}): Relaid {
  const { fields, assets, m } = c;
  const sf = frameOf(src0);
  const src = reflowDoc(src0, fields, m);
  const roles = rolesOf(src);
  const k = clamp(Math.sqrt((tf.w * tf.h) / (sf.w * sf.h)), 0.35, 2.2);
  const full: Box = { x: 0, y: 0, w: tf.w, h: tf.h };
  // Pictures, marks' neighbours and shapes follow the area as the words do, but never outgrow the short way round.
  const s = Math.min(Math.sqrt((tf.w * tf.h) / (sf.w * sf.h)), Math.min(tf.w / sf.w, tf.h / sf.h) * 1.35);

  // The photo panel of a design whose ground is not the photograph (a framed template); a full-bleed photo is the ground.
  const photoLayer = src.bg.photoId ? undefined : src.layers.find((l): l is ImageLayer => l.kind === 'image' && !l.hidden && roles.get(l.id) === 'photo');
  const hasPhoto = !!photoLayer || !!src.bg.photoId;
  const hasWords = shownTexts(src, fields).length > 0;
  const panel = !o.layersOnly && tf.w / tf.h > 1.4 && sf.w / sf.h <= 1.4 && hasPhoto && hasWords;
  const pw = Math.round(tf.w * 0.55);
  const P: Box = { x: 0, y: 0, w: pw, h: tf.h };
  const R: Box = panel ? { x: pw, y: 0, w: tf.w - pw, h: tf.h } : full;
  let needsExtend = false;

  const out: Layer[] = [];
  const stack = stackOf(src);
  const stackIds = new Set(stack.map(l => l.id));
  let stackDone = false;

  const mapStack = (): Layer[] => {
    const scaled = stack.map(l => scaleText(l, k, sf, R));
    const col = Math.max(...scaled.map(l => l.width));
    // Laid out at the origin first, then moved as one.
    const at = scaled.map((l, i) => ({ ...l, x: l.align === 'left' ? 0 : l.align === 'center' ? col / 2 : col, y: i === 0 ? 0 : l.y }));
    const probe: StoryDoc = reflowDoc({ ...src, frame: tf, layers: at }, fields, m);
    const shown = (ls: Layer[]) => ls.filter((l): l is TextLayer => l.kind === 'text' && !!textOf(l, fields).trim());
    const u0 = unionOf(shown(src.layers.filter(l => stackIds.has(l.id))).map(l => m.box(l)));
    const u1 = unionOf(shown(probe.layers).map(l => m.box(l)));
    if (!u0 || !u1) return scaled;
    const p = place(u0, u1, sf, R);
    const dx = p.x - u1.x, dy = p.y - u1.y;
    return (probe.layers as TextLayer[]).map(l => ({ ...l, x: Math.round(l.x + dx), y: Math.round(l.y + dy) }));
  };

  const mapLayer = (l: Layer): Layer => {
    const role = roles.get(l.id) ?? roleOf(l, src);
    switch (l.kind) {
      case 'text': {
        const sc = scaleText(l, k, sf, R);
        const b0 = m.box(l), b1 = m.box({ ...sc, x: 0, y: 0 });
        const p = place(b0, b1, sf, R);
        return { ...sc, x: Math.round(p.x - b1.x), y: Math.round(p.y - b1.y), flow: undefined };
      }
      case 'wordmark': {
        const sc: MarkLayer = { ...l, width: clamp(Math.round(l.width * k), 40, 1080) };
        const b0 = m.box(l), b1 = m.box({ ...sc, x: 0, y: 0 });
        const p = place(b0, b1, sf, R);
        return { ...sc, x: Math.round(p.x), y: Math.round(p.y) };
      }
      case 'qr': {
        // Like a mark: square always, nearest corner and margin kept; the quiet zone scales with it.
        const w = qrSide(l.w, s, tf);
        const b0 = m.box(l);
        const p = place(b0, { x: 0, y: 0, w, h: w }, sf, R);
        const sc: QrLayer = { ...l, w, x: Math.round(p.x), y: Math.round(p.y), ...(l.layerFx ? { layerFx: scaleFx(l.layerFx, w / l.w) } : {}) };
        return sc;
      }
      case 'image': {
        const b0 = m.box(l);
        if (role === 'photo' && panel && l === photoLayer) {
          const a = aspectOfPhoto(l.photoId, assets, c.photoAspect);
          const crop = layerCrop(a, c.subject, P);
          needsExtend ||= crop.needsExtend;
          return { ...l, x: P.x, y: P.y, w: P.w, h: P.h, fx: crop.fx, fy: crop.fy, iz: crop.iz };
        }
        // A picture that fills the frame stretches with it; an inset keeps its shape and its place.
        const fills = b0.w >= sf.w * 0.9 && b0.h >= sf.h * 0.9;
        const sc: ImageLayer = fills
          ? { ...l, x: Math.round((b0.x / sf.w) * tf.w), y: Math.round((b0.y / sf.h) * tf.h), w: Math.round((b0.w / sf.w) * tf.w), h: Math.round((b0.h / sf.h) * tf.h) }
          : { ...l, w: Math.max(40, Math.round(l.w * s)), ...(l.h ? { h: Math.max(40, Math.round(l.h * s)) } : {}) };
        if (!fills) {
          const b1 = m.box({ ...sc, x: 0, y: 0 });
          const p = place(b0, b1, sf, R);
          sc.x = Math.round(p.x); sc.y = Math.round(p.y);
        }
        if (role === 'photo') {
          const a = aspectOfPhoto(l.photoId, assets, c.photoAspect);
          const b = m.box(sc);
          const crop = layerCrop(a, c.subject, { w: b.w, h: b.h });
          needsExtend ||= crop.needsExtend;
          return { ...sc, fx: crop.fx, fy: crop.fy, iz: crop.iz };
        }
        return sc;
      }
      default: {
        // Shapes. A frame or band stretches with the frame; anything else keeps its corner and margin.
        const sh = l as ShapeLayer;
        const x0 = Math.min(sh.x, sh.x + sh.w), y0 = Math.min(sh.y, sh.y + sh.h);
        const raw: Box = { x: x0, y: y0, w: Math.abs(sh.w), h: Math.abs(sh.h) };
        const stroke = sh.stroke > 0 ? clamp(Math.round(sh.stroke * Math.sqrt(s)), 1, 60) : sh.stroke;
        if (role === 'frame' || role === 'band') {
          const fx = tf.w / sf.w, fy = tf.h / sf.h;
          return { ...sh, x: Math.round(sh.x * fx), y: Math.round(sh.y * fy), w: Math.round(sh.w * fx), h: Math.round(sh.h * fy), stroke };
        }
        const b1: Box = { x: 0, y: 0, w: raw.w * s, h: raw.h * s };
        const p = place(raw, b1, sf, full);
        return { ...sh, x: Math.round(sh.w < 0 ? p.x + b1.w : p.x), y: Math.round(sh.h < 0 ? p.y + b1.h : p.y), w: Math.round(sh.w * s), h: Math.round(sh.h * s), stroke, ...(sh.layerFx ? { layerFx: scaleFx(sh.layerFx, s) } : {}) };
      }
    }
  };

  for (const l of src.layers) {
    if (stackIds.has(l.id)) {
      if (!stackDone) { out.push(...mapStack()); stackDone = true; }
      continue;
    }
    out.push(mapLayer(l));
  }

  if (o.layersOnly) return { doc: { ...src, frame: tf, layers: out }, needsExtend, panel: false };

  // The ground: the full-bleed photograph re-framed, or — for a wide shape — set in a panel beside the words.
  let bg = { ...src.bg };
  let layers = out;
  let doc: StoryDoc = { ...src, frame: tf, layers };
  if (panel && bg.photoId) {
    const a = aspectOfPhoto(bg.photoId, assets, c.photoAspect);
    const crop = layerCrop(a, c.subject, P);
    needsExtend ||= crop.needsExtend;
    const words = shownTexts(src, fields);
    const light = words.length ? words.reduce((n, l) => n + lum(l.color), 0) / words.length > 0.55 : true;
    const piece: ImageLayer = {
      id: newId('image'), kind: 'image', photoId: bg.photoId, x: P.x, y: P.y, w: P.w, h: P.h, fx: crop.fx, fy: crop.fy, iz: crop.iz,
      radius: 0, border: null, shadow: false, rotate: 0, opacity: 1, role: 'photo', ...(bg.adjust ? { adjust: bg.adjust } : {}),
    };
    layers = [piece, ...out];
    bg = { ...bg, photoId: null, gradient: 'none', dim: 0, shade: null, adjust: null, color: light ? VISUAL.ground : VISUAL.bone, color2: null };
    doc = { ...src, frame: tf, bg, layers };
  } else if (bg.photoId) {
    const a = aspectOfPhoto(bg.photoId, assets, c.photoAspect);
    const cur = withPlacementOf(src);
    const fit = fitSubject(a, c.subject, tf, cur.zoom);
    needsExtend ||= fit.needsExtend;
    doc = withPlacement({ ...src, frame: tf, bg, layers }, fit.placement);
  }
  return { doc: settle(doc, fields, m), needsExtend, panel };
}

const withPlacementOf = (d: StoryDoc): Placement =>
  d.placements ? (d.bg.photoId ? d.placements[d.bg.photoId] : undefined) ?? d.bg.placement : d.bg.placement;

// ── The template re-layout (strategy 1) ────────────────────────────────────

const isOwn = (l: Layer) => !(l.name === TEMPLATE_LAYER || (l.kind === 'text' && !!l.bind) || l.kind === 'wordmark');

function templateOf(doc: StoryDoc): AdTemplateId | null {
  const id = doc.meta?.template;
  return AD_TEMPLATES.some(t => t.id === id) ? (id as AdTemplateId) : null;
}

/** Whether the document is still the template as laid (no hand moved the words): only then does laying it again lose nothing. */
function templateIntact(doc: StoryDoc, id: AdTemplateId, c: Ctx, o: ResizeOptions): boolean {
  try {
    const f = frameOf(doc);
    const again = applyAdTemplate({ ...doc, layers: doc.layers.filter(isOwn) }, id, c.fields, c.assets, { photoMarked: o.photoMarked, rates: o.rates });
    const bound = (d: StoryDoc) => d.layers.filter((l): l is TextLayer => l.kind === 'text' && !!l.bind);
    const was = bound(doc), now = bound(again);
    if (was.length !== now.length) return false;
    return was.every(l => {
      const n = now.find(x => x.bind === l.bind);
      return !!n && Math.abs(n.x - l.x) <= f.w * 0.02 && Math.abs(n.y - l.y) <= f.h * 0.02 && Math.abs(n.size - l.size) <= l.size * 0.1 && n.align === l.align;
    });
  } catch {
    return false;
  }
}

function templateRelay(src: StoryDoc, tf: Frame, c: Ctx, o: ResizeOptions): Relaid | null {
  const id = templateOf(src);
  if (!id || !templateIntact(src, id, c, o)) return null;
  try {
    const own = relay({ ...src, layers: src.layers.filter(isOwn) }, tf, c, { layersOnly: true });
    const base: StoryDoc = { ...src, frame: tf, layers: [] };
    const laid = applyAdTemplate(base, id, c.fields, c.assets, { photoMarked: o.photoMarked, rates: o.rates });
    let doc: StoryDoc = { ...laid, layers: [...laid.layers, ...own.doc.layers] };
    let needsExtend = own.needsExtend;
    const aspect = aspectOfPhoto(TEMPLATE_PHOTO, c.assets, c.photoAspect);
    if (doc.bg.photoId) {
      const fit = fitSubject(aspect, c.subject, tf, 1);
      needsExtend ||= fit.needsExtend;
      doc = withPlacement(doc, fit.placement);
    }
    doc = {
      ...doc,
      layers: doc.layers.map(l => {
        if (l.kind !== 'image' || roleOf(l, doc) !== 'photo') return l;
        const b = c.m.box(l);
        const crop = layerCrop(aspect, c.subject, { w: b.w, h: b.h });
        needsExtend ||= crop.needsExtend;
        return { ...l, fx: crop.fx, fy: crop.fy, iz: crop.iz };
      }),
    };
    return { doc: reflowDoc(doc, c.fields, c.m), needsExtend, panel: false };
  } catch {
    return null;
  }
}

// ── The safe pass (strategy 3) ─────────────────────────────────────────────


/** QR codes kept scannable and inside the room: square, at least `QR_MIN`, never over the room's short side, moved in from the edges. */
function keepQr(doc: StoryDoc, room: Box): StoryDoc {
  let changed = false;
  const layers = doc.layers.map(l => {
    if (l.kind !== 'qr' || l.hidden) return l;
    const w = clamp(l.w, QR_MIN, Math.max(QR_MIN, Math.floor(Math.min(room.w, room.h))));
    const x = Math.round(clamp(l.x, room.x, Math.max(room.x, room.x + room.w - w)));
    const y = Math.round(clamp(l.y, room.y, Math.max(room.y, room.y + room.h - w)));
    if (w === l.w && x === l.x && y === l.y) return l;
    changed = true;
    return { ...l, w, x, y };
  });
  return changed ? { ...doc, layers } : doc;
}

/**
 * Words brought inside the frame and the safe bands, and under-sized words raised to the legible minimum. The stack
 * moves as one (shrinking if it is taller than the room); other lines move on their own.
 */
export function repairLayout(input: StoryDoc, fields: Fields, m: Measure, bands: SafeBands = safeBands(frameOf(input)), seen?: { assets: Assets; subject: Box01; photoAspect: number }): StoryDoc {
  const f = frameOf(input);
  const floor = minTextSize(f);
  const room: Box = { x: bands.left, y: bands.top, w: f.w - bands.left - bands.right, h: f.h - bands.top - bands.bottom };
  // Legible first: raise whatever draws under the minimum (a fitted line draws smaller than it says).
  let doc = reflowDoc({
    ...input,
    layers: input.layers.map(l => {
      if (l.kind !== 'text' || l.hidden || !textOf(l, fields).trim()) return l;
      const eff = m.textSize(l);
      return eff < floor - 0.5 ? { ...l, size: clamp(Math.ceil((l.size * floor) / Math.max(1, eff)), 12, 600) } : l;
    }),
  }, fields, m);

  doc = keepQr(doc, room);
  const stackIds = new Set(stackOf(doc).map(l => l.id));
  const fix = (ids: Set<string>, whole: boolean) => {
    const members = doc.layers.filter((l): l is TextLayer => l.kind === 'text' && ids.has(l.id) && !l.hidden && !!textOf(l, fields).trim());
    let u = unionOf(members.map(l => m.box(l)));
    if (!u) return;
    if (u.h > room.h + 0.5 && whole) {
      const q = (room.h / u.h) * 0.97;
      doc = reflowDoc({ ...doc, layers: doc.layers.map(l => (l.kind === 'text' && ids.has(l.id) ? { ...l, size: clamp(Math.floor(l.size * q), 12, 600), ...(l.flow ? { flow: { gap: Math.round(l.flow.gap * q) } } : {}) } : l)) }, fields, m);
      u = unionOf(members.map(l => m.box(doc.layers.find(x => x.id === l.id)!)))!;
    }
    let dy = 0, dx = 0;
    if (u.y < room.y) dy = room.y - u.y;
    else if (u.y + u.h > room.y + room.h) dy = room.y + room.h - (u.y + u.h);
    if (u.x < room.x) dx = room.x - u.x;
    else if (u.x + u.w > room.x + room.w) dx = room.x + room.w - (u.x + u.w);
    if (dx || dy) doc = reflowDoc({ ...doc, layers: doc.layers.map(l => (l.kind === 'text' && ids.has(l.id) ? shiftText(l, dx, dy) : l)) }, fields, m);
  };
  if (stackIds.size) fix(stackIds, true);
  for (const l of shownTexts(doc, fields)) if (!stackIds.has(l.id)) fix(new Set([l.id]), false);
  doc = settle(doc, fields, m, room);
  doc = keepQr(doc, room);
  return seen ? keepQr(clearMarks(doc, fields, m, room, seen), room) : doc;
}


const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const overlapArea = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** A mark lying on the piece goes to the nearest corner of the room that is clear of the piece and of the words. */
function clearMarks(doc: StoryDoc, fields: Fields, m: Measure, room: Box, seen: { assets: Assets; subject: Box01; photoAspect: number }): StoryDoc {
  const subj = subjectInFrame(doc, seen.assets, seen.subject, seen.photoAspect);
  if (!subj) return doc;
  const words = shownTexts(doc, fields).map(l => m.box(l));
  const margin = Math.round(Math.min(room.w, room.h) * 0.04);
  let changed = false;
  const layers = doc.layers.map(l => {
    if ((l.kind !== 'wordmark' && l.kind !== 'qr') || l.hidden) return l;
    const b = m.box(l);
    if (overlapArea(b, subj.rect) <= 0.05 * area(b)) return l;
    const corners = [
      { x: room.x + margin, y: room.y + margin }, { x: room.x + room.w - margin - b.w, y: room.y + margin },
      { x: room.x + margin, y: room.y + room.h - margin - b.h }, { x: room.x + room.w - margin - b.w, y: room.y + room.h - margin - b.h },
    ].sort((p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y));
    const spot = corners.find(p => {
      const nb = { x: p.x, y: p.y, w: b.w, h: b.h };
      return overlapArea(nb, subj.rect) <= 0.05 * area(nb) && words.every(w => overlapArea(nb, w) === 0);
    });
    if (!spot) return l;
    changed = true;
    return { ...l, x: Math.round(spot.x), y: Math.round(spot.y) };
  });
  return changed ? { ...doc, layers } : doc;
}

// ── resize() ───────────────────────────────────────────────────────────────

interface Candidate { strategy: Strategy; doc: StoryDoc; needsExtend: boolean; notes: string[] }

export function resizeOne(doc: StoryDoc, fields: Fields, assets: Assets, tf: Frame, o: ResizeOptions = {}): ResizeResult {
  const m = o.measure ?? makeMeasure(fields, assets);
  const subject = o.subject ?? doc.meta?.subject ?? DEFAULT_SUBJECT;
  const c: Ctx = { fields, assets, m, subject, photoAspect: o.photoAspect ?? photoAspectOf(doc, assets, 1) };
  const bands = safeBands(tf);
  const seen = { assets, subject, photoAspect: c.photoAspect };
  const cands: Candidate[] = [];
  const add = (strategy: Strategy, d: StoryDoc, needsExtend: boolean, notes: string[]) => cands.push({ strategy, doc: d, needsExtend, notes });

  const t = templateRelay(doc, tf, c, o);
  if (t) {
    add('template', t.doc, t.needsExtend, ['The template laid again for this shape.']);
    const fixed = repairLayout(t.doc, fields, m, bands, seen);
    if (fixed !== t.doc) add('template', fixed, t.needsExtend, ['The template laid again, the words brought inside the safe area.']);
  }
  const a = relay(doc, tf, c);
  add('anchor', a.doc, a.needsExtend, [a.panel ? 'The photo beside the words.' : 'Every layer kept its corner and margin.']);
  const safe = repairLayout(a.doc, fields, m, bands, seen);
  if (safe !== a.doc) add('safe', safe, a.needsExtend, ['The words brought inside the safe area.']);

  const scored = cands.map(x => ({ x, s: scoreLayout(x.doc, fields, assets, { subject: o.subject ?? doc.meta?.subject, photoAspect: c.photoAspect, measure: m, bands }) }));
  // The best score wins; a tie goes to the earlier (the template, then the plain anchor).
  let best = scored[0];
  for (const e of scored) if (e.s.score > best.s.score) best = e;
  const notes = [...best.x.notes];
  if (best.x.needsExtend) notes.push('The piece does not fill this shape: the photo is shown whole. Extend the photo to fill it.');
  return {
    frame: tf,
    doc: { ...best.x.doc, frame: tf },
    score: best.s.score,
    strategy: best.x.strategy,
    needsExtend: best.x.needsExtend,
    notes,
    penalties: best.s.penalties,
    candidates: scored.map(e => ({ strategy: e.x.strategy, score: e.s.score })),
  };
}

/** One document into each target frame; the results are in the order of `targets`. */
export function resize(doc: StoryDoc, fields: Fields, assets: Assets, targets: Frame[], o: ResizeOptions = {}): ResizeResult[] {
  const m = o.measure ?? makeMeasure(fields, assets);
  return targets.map(tf => resizeOne(doc, fields, assets, tf, { ...o, measure: m }));
}

// ── Pages ──────────────────────────────────────────────────────────────────

export interface ResizedPage { page: DesignPage; doc: StoryDoc; needsExtend: boolean; score: number }

/** A result as a page of the design set (plan §3.3): origin 'resized', kept in sync with its master. */
export function pageOf(r: ResizeResult, o: { format?: string; label?: string; master?: string } = {}): ResizedPage {
  const format: AdFormat = o.format && isAdFormat(o.format) ? (o.format as AdFormat) : 'custom';
  return {
    page: {
      id: newId('page').slice(0, 40),
      label: o.label ?? `${r.frame.w}×${r.frame.h}`,
      format,
      frame: r.frame,
      origin: 'resized',
      ...(o.master ? { syncedFrom: o.master } : {}),
      rev: 0,
    },
    doc: r.doc,
    needsExtend: r.needsExtend,
    score: r.score,
  };
}

/** The document with another photograph on the page (a photo the AI extended): the background and every layer that showed the old one. */
export function swapPhoto(doc: StoryDoc, from: string, to: string): StoryDoc {
  return {
    ...doc,
    bg: doc.bg.photoId === from ? { ...doc.bg, photoId: to } : doc.bg,
    ...(doc.placements && doc.placements[from] ? { placements: { ...doc.placements, [to]: doc.placements[from] } } : {}),
    layers: doc.layers.map(l => (l.kind === 'image' && l.photoId === from && !l.src ? { ...l, photoId: to } : l)),
  };
}
