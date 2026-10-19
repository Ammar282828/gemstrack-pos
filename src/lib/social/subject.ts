/**
 * Subject-aware stories (owner, 2026-10-19: "in posts, when formatting for stories, have it be smart enough to
 * understand the subject in the image and not cover it with text").
 *
 * Two pure pieces, shared by the web, the iPhone app's bundle and Android's:
 *  - `findSubject` finds the piece in a photograph (jewellery is shot on a plain or gradient ground): the box,
 *    0…1 of the photo, or null when nothing stands out clearly (a busy picture).
 *  - `avoidSubject` moves a laid-out story's words off that box: the block goes to the largest free band above
 *    or below the piece, else the photo is panned, and only as a last resort the words shrink (never below 80%).
 * `withFoundSubject` runs the first on the photo (a small canvas, cached per image) and keeps the answer on the
 * document (`meta.found`) so a preset change does not look again. An explicit `meta.subject` (a person's or an
 * app's better box) always wins.
 */

import { frameOf, layerBox, placementOf, textOf, withPlacement, reflow, scaleLayer, type Assets, type Box, type Box01, type Fields, type Layer, type StoryDoc, type TextLayer } from './editor';
import type { Frame, Placement } from './story';

// ── Finding the subject ────────────────────────────────────────────────────

export interface Pixels { data: ArrayLike<number>; width: number; height: number }

const EDGE = 128;

/** The picture's box average at ≤ EDGE on its long side, as RGB floats (transparent pixels count as white). */
function shrink(p: Pixels): { w: number; h: number; rgb: Float32Array } | null {
  const { width: sw, height: sh, data } = p;
  if (!sw || !sh || data.length < sw * sh * 4) return null;
  const k = Math.min(1, EDGE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const sum = new Float32Array(w * h * 3), n = new Float32Array(w * h);
  for (let y = 0; y < sh; y++) {
    const dy = Math.min(h - 1, Math.floor((y * h) / sh));
    for (let x = 0; x < sw; x++) {
      const dx = Math.min(w - 1, Math.floor((x * w) / sw));
      const i = (y * sw + x) * 4, o = dy * w + dx;
      const a = data[i + 3] / 255;
      sum[o * 3] += data[i] * a + 255 * (1 - a);
      sum[o * 3 + 1] += data[i + 1] * a + 255 * (1 - a);
      sum[o * 3 + 2] += data[i + 2] * a + 255 * (1 - a);
      n[o]++;
    }
  }
  for (let o = 0; o < w * h; o++) if (n[o]) { sum[o * 3] /= n[o]; sum[o * 3 + 1] /= n[o]; sum[o * 3 + 2] /= n[o]; }
  return { w, h, rgb: sum };
}

/** A running median over ±r, so a subject crossing the border does not drag the ground's estimate. */
function median1d(a: Float32Array, r: number): Float32Array {
  const out = new Float32Array(a.length);
  const win: number[] = [];
  for (let i = 0; i < a.length; i++) {
    win.length = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(a.length - 1, i + r); j++) win.push(a[j]);
    win.sort((x, y) => x - y);
    out[i] = win[win.length >> 1];
  }
  return out;
}

function otsu(values: Float32Array, bins = 100): number {
  const hist = new Float64Array(bins);
  for (const v of values) hist[Math.min(bins - 1, Math.max(0, Math.floor(v * bins)))]++;
  const total = values.length;
  let sumAll = 0;
  for (let i = 0; i < bins; i++) sumAll += i * hist[i];
  let wB = 0, sumB = 0, best = 0, at = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; at = i; }
  }
  return (at + 1) / bins;
}

const imageCache = new WeakMap<object, Box01 | null>();

/**
 * Where the piece is in a photograph: the ground is estimated from the border (row by row and column by column,
 * so a gradient is followed), every pixel scored by how far it is from the ground plus how sharp its edge is,
 * thresholded adaptively, close fragments joined, and the largest, most central blob boxed and padded a little.
 * Null when there is no clear subject: the border is not a plain ground, nothing or nearly everything stands out,
 * or the foreground is in many comparable fragments.
 */
export function findSubject(pixels: Pixels): Box01 | null {
  const img = shrink(pixels);
  if (!img || img.w < 8 || img.h < 8) return null;
  const { w, h, rgb } = img;
  const N = w * h;
  const b = Math.max(1, Math.round(Math.min(w, h) * 0.03));

  // The ground from the border: left/right per row, top/bottom per column.
  const prof = (len: number, at: (i: number, k: number) => number): Float32Array[] => {
    const out = [new Float32Array(len), new Float32Array(len), new Float32Array(len)];
    for (let i = 0; i < len; i++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < b; k++) s += rgb[at(i, k) * 3 + c];
      out[c][i] = s / b;
    }
    return out.map(a => median1d(a, 4));
  };
  const L = prof(h, (y, k) => y * w + k), R = prof(h, (y, k) => y * w + (w - 1 - k));
  const T = prof(w, (x, k) => k * w + x), B = prof(w, (x, k) => (h - 1 - k) * w + x);
  const bg = new Float32Array(N * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = w > 1 ? x / (w - 1) : 0, fy = h > 1 ? y / (h - 1) : 0;
    for (let c = 0; c < 3; c++) {
      const hor = L[c][y] + (R[c][y] - L[c][y]) * fx, ver = T[c][x] + (B[c][x] - T[c][x]) * fy;
      bg[(y * w + x) * 3 + c] = (hor + ver) / 2;
    }
  }

  // Colour distance from the ground, and the edges of the difference (a smooth ground has none).
  const diffL = new Float32Array(N), dist = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dr = rgb[i * 3] - bg[i * 3], dg = rgb[i * 3 + 1] - bg[i * 3 + 1], db = rgb[i * 3 + 2] - bg[i * 3 + 2];
    dist[i] = Math.sqrt(dr * dr + dg * dg + db * db) / 441.67;
    diffL[i] = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
  }
  const score = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = (xx: number, yy: number) => diffL[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
    const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
    const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    const e = Math.min(1, Math.sqrt(gx * gx + gy * gy) / (255 * 4));
    score[y * w + x] = Math.min(1, dist[y * w + x] + 0.6 * e);
  }

  // The ground's own noise sets a floor under the threshold.
  const ring: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < b || y < b || x >= w - b || y >= h - b) ring.push(score[y * w + x]);
  ring.sort((p, q) => p - q);
  const floor = ring[ring.length >> 1] + 0.08;
  const t = Math.min(0.45, Math.max(otsu(score), floor, 0.12));
  const mask = new Uint8Array(N);
  let fg = 0, ringFg = 0;
  for (let i = 0; i < N; i++) if (score[i] > t) { mask[i] = 1; fg++; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x < b || y < b || x >= w - b || y >= h - b) && mask[y * w + x]) ringFg++;
  if (fg < N * 0.006 || fg > N * 0.75 || ringFg > ring.length * 0.45) return null;

  // Join what is close (the gaps in a ring, a chain's links): grow the mask, label the grown shapes.
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.02));
  const grow = (src: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!src[y * w + x]) continue;
      if (horizontal) for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) out[y * w + k] = 1;
      else for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) out[k * w + x] = 1;
    }
    return out;
  };
  const grown = grow(grow(mask, true), false);
  const label = new Int32Array(N).fill(-1);
  interface Blob { n: number; x0: number; y0: number; x1: number; y1: number; sx: number; sy: number }
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!grown[s] || label[s] >= 0) continue;
    const id = blobs.length;
    const blob: Blob = { n: 0, x0: w, y0: h, x1: -1, y1: -1, sx: 0, sy: 0 };
    label[s] = id; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      if (mask[i]) {
        blob.n++; blob.sx += x; blob.sy += y;
        if (x < blob.x0) blob.x0 = x; if (x > blob.x1) blob.x1 = x;
        if (y < blob.y0) blob.y0 = y; if (y > blob.y1) blob.y1 = y;
      }
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && grown[j] && label[j] < 0) { label[j] = id; stack.push(j); }
      }
    }
    blobs.push(blob);
  }
  const kept = blobs.filter(q => q.n >= N * 0.002);
  if (!kept.length) return null;
  const total = kept.reduce((n, q) => n + q.n, 0);

  // The largest blob, favouring the middle of the picture.
  const half = Math.hypot(w, h) / 2;
  const worth = (q: Blob) => q.n * (1 - 0.6 * Math.min(1, Math.hypot(q.sx / q.n - w / 2, q.sy / q.n - h / 2) / half));
  const best = kept.reduce((a, q) => (worth(q) > worth(a) ? q : a));
  // Fragments in comparable pieces everywhere are a busy picture, not one thing on a ground.
  if (best.n < total * 0.35) return null;

  // Join blobs near it that are a real size (a pair of earrings is one subject).
  let box = { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1 };
  const gap = Math.max(w, h) * 0.12;
  for (let changed = true; changed;) {
    changed = false;
    for (const q of kept) {
      if (q === best || q.n < best.n * 0.2) continue;
      const near = q.x0 <= box.x1 + gap && q.x1 >= box.x0 - gap && q.y0 <= box.y1 + gap && q.y1 >= box.y0 - gap;
      const inside = q.x0 >= box.x0 && q.x1 <= box.x1 && q.y0 >= box.y0 && q.y1 <= box.y1;
      if (near && !inside) { box = { x0: Math.min(box.x0, q.x0), y0: Math.min(box.y0, q.y0), x1: Math.max(box.x1, q.x1), y1: Math.max(box.y1, q.y1) }; changed = true; }
    }
  }
  const bw = (box.x1 + 1 - box.x0) / w, bh = (box.y1 + 1 - box.y0) / h;
  if ((bw > 0.95 && bh > 0.95) || bw * bh > 0.85 || bw * bh < 0.004) return null;

  const pad = 0.04;
  const x = Math.max(0, box.x0 / w - pad), y = Math.max(0, box.y0 / h - pad);
  const x2 = Math.min(1, (box.x1 + 1) / w + pad), y2 = Math.min(1, (box.y1 + 1) / h + pad);
  return { x, y, w: x2 - x, h: y2 - y };
}

/** The subject of a loaded image through a small canvas, remembered per image; null with no canvas (a server, a test) or a tainted picture. */
export function subjectOfImage(img: { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number }): Box01 | null {
  if (imageCache.has(img)) return imageCache.get(img) ?? null;
  let found: Box01 | null = null;
  try {
    const iw = img.naturalWidth || img.width || 0, ih = img.naturalHeight || img.height || 0;
    if (iw && ih && typeof document !== 'undefined') {
      const k = Math.min(1, EDGE / Math.max(iw, ih));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
      const ctx = c.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (ctx) {
        ctx.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
        const d = ctx.getImageData(0, 0, c.width, c.height);
        found = findSubject({ data: d.data, width: d.width, height: d.height });
      }
    }
  } catch { found = null; }
  imageCache.set(img, found);
  return found;
}

/** The box to keep clear on this document: an explicit `meta.subject` first, else the one found on its photo. */
export function subjectOf(doc: StoryDoc, a: Assets): Box01 | null {
  if (doc.meta?.subject) return doc.meta.subject;
  const id = doc.bg.photoId;
  if (!id) return null;
  if (doc.meta?.found && doc.meta.found.photoId === id) return doc.meta.found.box;
  const img = a.photos?.[id];
  return img ? subjectOfImage(img) : null;
}

/** The document with the subject it found kept in `meta.found` (nothing added when none is found or one is given). */
export function withFoundSubject(doc: StoryDoc, a: Assets): StoryDoc {
  const id = doc.bg.photoId;
  if (!id || doc.meta?.subject || doc.meta?.found?.photoId === id) return doc;
  const img = a.photos?.[id];
  const box = img ? subjectOfImage(img) : null;
  return box ? { ...doc, meta: { ...doc.meta, found: { photoId: id, box } } } : doc;
}

// ── Keeping the words off it ───────────────────────────────────────────────

/** Where Instagram draws over a story: the same bands the engine's safe area uses (design/safe.ts). */
const TOP = 0.14, BOTTOM = 0.2;
const GAP = 24;

const area = (b: Box) => Math.max(0, b.w) * Math.max(0, b.h);
const overlapArea = (a: Box, b: Box) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
/** Where a photo of this aspect (w/h) is drawn in the frame: drawStoryPhoto's maths. */
function photoRect(aspect: number, p: Placement, f: Frame): Box {
  const cover = Math.max(f.w / aspect, f.h), contain = Math.min(f.w / aspect, f.h);
  const s = (p.mode === 'fill' ? cover : contain) * Math.max(1, p.zoom);
  const dw = aspect * s, dh = s;
  return { x: dw > f.w ? -(dw - f.w) * p.focusX : (f.w - dw) * p.focusX, y: dh > f.h ? -(dh - f.h) * p.focusY : (f.h - dh) * p.focusY, w: dw, h: dh };
}
/** The subject in frame units. */
export function subjectInStory(doc: StoryDoc, subject: Box01, a: Assets): Box | null {
  const id = doc.bg.photoId, img = id ? a.photos?.[id] : undefined;
  if (!id || !img || !img.naturalWidth || !img.naturalHeight) return null;
  const r = photoRect(img.naturalWidth / img.naturalHeight, placementOf(doc), frameOf(doc));
  return { x: r.x + subject.x * r.w, y: r.y + subject.y * r.h, w: subject.w * r.w, h: subject.h * r.h };
}

export interface AvoidOptions {
  /** Only these layers are the layout's own (a preset's); the rest are the person's and stay put. Default: every unlocked text and mark. */
  ids?: ReadonlySet<string>;
  measure?: (l: Layer) => Box;
}

const isWords = (l: Layer, fields: Fields): l is TextLayer => l.kind === 'text' && !l.hidden && !l.locked && !!textOf(l, fields).trim();

/**
 * A story's laid-out words moved off the piece. The text block (every line, in order and spacing) goes to the
 * free band above or below the subject nearest where it was; a mark that sits on the piece moves to a clear spot.
 * No band tall enough: the photo is panned within its crop (the least that works), and last the block is scaled
 * down, never under 80%. Nothing touches the subject → the document is returned as it came.
 */
export function avoidSubject(doc: StoryDoc, subject: Box01, fields: Fields, a: Assets, o: AvoidOptions = {}): StoryDoc {
  const f = frameOf(doc);
  if (f.h < f.w * 1.6 || !doc.bg.photoId) return doc;
  const img = a.photos?.[doc.bg.photoId];
  if (!img || !img.naturalWidth || !img.naturalHeight) return doc;
  const aspect = img.naturalWidth / img.naturalHeight;
  const measure = o.measure ?? ((l: Layer) => layerBox(l, fields, a));
  const mine = (l: Layer) => !o.ids || o.ids.has(l.id);
  const words = doc.layers.filter(l => mine(l) && isWords(l, fields)) as TextLayer[];
  // An empty line still anchors its stack (reflow starts a stack at its first line), so it moves with the rest.
  const movers = new Set(doc.layers.filter(l => mine(l) && l.kind === 'text' && !l.hidden && !l.locked).map(l => l.id));
  const marks = doc.layers.filter(l => mine(l) && l.kind === 'wordmark' && !l.hidden && !l.locked);
  if (!words.length && !marks.length) return doc;

  const bandTop = Math.round(f.h * TOP), bandBottom = f.h - Math.round(f.h * BOTTOM);
  const shrunk = (b: Box): Box => ({ x: b.x + 3, y: b.y + 3, w: Math.max(0, b.w - 6), h: Math.max(0, b.h - 6) });
  const rectFor = (p: Placement): Box => {
    const r = photoRect(aspect, p, f);
    return { x: r.x + subject.x * r.w, y: r.y + subject.y * r.h, w: subject.w * r.w, h: subject.h * r.h };
  };
  const union = (bs: Box[]): Box => {
    const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
    return { x: x0, y: y0, w: Math.max(...bs.map(b => b.x + b.w)) - x0, h: Math.max(...bs.map(b => b.y + b.h)) - y0 };
  };
  const p0 = placementOf(doc);
  const s0 = rectFor(p0);
  const wordBoxes = words.map(measure);
  const wordsHit = wordBoxes.some(b => overlapArea(shrunk(b), s0) > 0);
  const marksHit = marks.some(l => overlapArea(shrunk(measure(l)), s0) > 0);
  if (!wordsHit && !marksHit) return doc;

  let out = doc;
  let subjectNow = s0;

  if (wordsHit) {
    const U = union(wordBoxes);
    // The visible share of the subject, so a pan never trades the piece for room.
    const visible = (r: Box) => (area(r) ? overlapArea(r, { x: 0, y: 0, w: f.w, h: f.h }) / area(r) : 1);
    const v0 = visible(s0);
    // Pans the crop allows, the least movement first (the current one first of all).
    const r0 = photoRect(aspect, p0, f);
    const canX = r0.w > f.w + 1, canY = r0.h > f.h + 1;
    const steps = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    const pans: Placement[] = [p0];
    if (canX || canY) {
      const c: Placement[] = [];
      for (const fx of canX ? steps : [p0.focusX]) for (const fy of canY ? steps : [p0.focusY]) {
        if (fx === p0.focusX && fy === p0.focusY) continue;
        c.push({ ...p0, focusX: fx, focusY: fy });
      }
      c.sort((p, q) => Math.hypot(p.focusX - p0.focusX, p.focusY - p0.focusY) - Math.hypot(q.focusX - p0.focusX, q.focusY - p0.focusY));
      pans.push(...c);
    }
    // Scaled copies of the block about its top-left, every line (and each gap) by k.
    const scaled = (k: number): Layer[] => doc.layers.map(l => {
      if (!movers.has(l.id) || l.kind !== 'text') return l;
      const s = scaleLayer(l, k) as TextLayer;
      return { ...s, x: l.x, y: U.y + (l.y - U.y) * k, ...(l.flow ? { flow: { ...l.flow, gap: Math.round(l.flow.gap * k) } } : {}) };
    });
    const tryAt = (layers: Layer[], p: Placement, k: number): StoryDoc | null => {
      const s = rectFor(p);
      if (visible(s) < Math.min(v0, 0.95) - 0.005) return null;
      const H = U.h * k;
      const bands = [
        { y0: bandTop, y1: s.y - GAP },
        { y0: s.y + s.h + GAP, y1: bandBottom },
      ].filter(b => b.y1 - b.y0 >= H);
      // The band nearest where the block was.
      const options = bands.map(b => ({ top: Math.min(Math.max(U.y, b.y0), b.y1 - H) })).sort((x, y) => Math.abs(x.top - U.y) - Math.abs(y.top - U.y));
      for (const op of options) {
        const dy = op.top - U.y;
        const moved = layers.map(l => (movers.has(l.id) ? { ...l, y: l.y + dy } : l));
        const d = reflow(withPlacement({ ...doc, layers: moved }, p), fields, a);
        const bs = d.layers.filter(l => words.some(w => w.id === l.id) && isWords(l, fields)).map(measure);
        if (bs.every(b => overlapArea(shrunk(b), s) === 0)) return d;
      }
      return null;
    };
    let placed: StoryDoc | null = null, usedPan: Placement = p0;
    for (const k of [1, 0.9, 0.8]) {
      const layers = k === 1 ? doc.layers : scaled(k);
      for (const p of pans) { placed = tryAt(layers, p, k); if (placed) { usedPan = p; break; } }
      if (placed) break;
    }
    if (placed) { out = placed; subjectNow = rectFor(usedPan); }
  }

  // A mark on the piece goes to a clear spot (the same side first), clear of the words too.
  const stillWords = out.layers.filter(l => words.some(w => w.id === l.id) && isWords(l, fields)).map(measure);
  out = {
    ...out,
    layers: out.layers.map(l => {
      if (l.kind !== 'wordmark' || !marks.some(m => m.id === l.id)) return l;
      const b = measure(l);
      if (overlapArea(shrunk(b), subjectNow) === 0) return l;
      const ys = [subjectNow.y - GAP - b.h, subjectNow.y + subjectNow.h + GAP, 150, bandBottom - b.h]
        .filter(y => y >= 60 && y + b.h <= bandBottom)
        .sort((p, q) => Math.abs(p - b.y) - Math.abs(q - b.y));
      for (const y of ys) {
        const t: Box = { ...b, y };
        if (overlapArea(shrunk(t), subjectNow) === 0 && stillWords.every(w => overlapArea(shrunk(t), w) === 0)) return { ...l, y };
      }
      return l;
    }),
  };
  return out;
}
