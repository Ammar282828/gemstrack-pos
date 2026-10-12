/**
 * Designer v2, the layout helpers behind the rulers, guides, grid, Position numbers and keyboard (plan §6 WP2).
 * Pure: no DOM, no React, so the maths is tested in node. The panels and the stage call these and only draw.
 */

import type { Box } from './design';
import type { Layer, StoryDoc } from './editor';

// ── Guides and the grid ────────────────────────────────────────────────────

/** The user's own guide lines, in frame pixels: `x` are vertical lines, `y` horizontal ones. */
export interface Guides { x: number[]; y: number[] }
export const NO_GUIDES: Guides = { x: [], y: [] };
export const MAX_GUIDES = 40;
type Frame = { w: number; h: number };
type Meta = NonNullable<StoryDoc['meta']>;

const inside = (v: number, len: number) => Number.isFinite(v) && v > 0 && v < len;
const tidy = (vs: unknown, len: number): number[] =>
  [...new Set((Array.isArray(vs) ? vs : []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).map(v => Math.round(v)).filter(v => inside(v, len)))]
    .sort((a, b) => a - b).slice(0, MAX_GUIDES);

/** The guides a document has, kept inside its frame (a resize may have left one outside), whole pixels, sorted. */
export function guidesOf(meta: StoryDoc['meta'] | undefined, frame: Frame): Guides {
  return { x: tidy(meta?.guides?.x, frame.w), y: tidy(meta?.guides?.y, frame.h) };
}
export const hasGuides = (g: Guides) => g.x.length + g.y.length > 0;

export function addGuide(g: Guides, axis: 'x' | 'y', pos: number, frame: Frame): Guides {
  const len = axis === 'x' ? frame.w : frame.h;
  if (!inside(Math.round(pos), len)) return g;
  return { ...g, [axis]: tidy([...g[axis], pos], len) } as Guides;
}
/** Move the guide at `index` (in the sorted list) to `pos`; a position outside the frame deletes it (dragged back onto the ruler). */
export function moveGuide(g: Guides, axis: 'x' | 'y', index: number, pos: number, frame: Frame): Guides {
  const len = axis === 'x' ? frame.w : frame.h;
  const rest = g[axis].filter((_, i) => i !== index);
  return { ...g, [axis]: inside(Math.round(pos), len) ? tidy([...rest, pos], len) : rest } as Guides;
}
export function removeGuide(g: Guides, axis: 'x' | 'y', index: number): Guides {
  return { ...g, [axis]: g[axis].filter((_, i) => i !== index) } as Guides;
}

/** The document's meta with these guides (and none at all when empty, so a plain design stays plain). */
export function withGuides(meta: StoryDoc['meta'] | undefined, g: Guides): StoryDoc['meta'] {
  const rest: Meta = { ...(meta ?? {}) };
  delete rest.guides;
  const next: Meta = hasGuides(g) ? { ...rest, guides: { x: [...g.x], y: [...g.y] } } : rest;
  return Object.keys(next).length ? next : undefined;
}

export const GRID_SIZES = [10, 20, 30, 40, 60, 90, 120];
export const clampGrid = (n: number) => (Number.isFinite(n) && n >= 4 ? Math.min(400, Math.round(n)) : 0);
/** The document's meta with a grid of this size (0 or less removes it). */
export function withGrid(meta: StoryDoc['meta'] | undefined, size: number): StoryDoc['meta'] {
  const rest: Meta = { ...(meta ?? {}) };
  delete rest.grid;
  const g = clampGrid(size);
  const next: Meta = g ? { ...rest, grid: g } : rest;
  return Object.keys(next).length ? next : undefined;
}

/** The margin view: the rectangle inside the page's snapping margin. */
export function marginBox(frame: Frame, margin: number): Box {
  const m = Math.max(0, Math.min(margin, Math.min(frame.w, frame.h) / 2));
  return { x: m, y: m, w: frame.w - m * 2, h: frame.h - m * 2 };
}

// ── Rulers ─────────────────────────────────────────────────────────────────

/** A 1-2-5 step of at least `minPx` on screen: ruler labels never crowd, whatever the zoom. */
export function niceStep(scale: number, minPx = 56): number {
  const raw = minPx / Math.max(scale, 1e-6);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw - 1e-9) return m * pow;
  return 10 * pow;
}

/** Ticks along a ruler `len` frame-pixels long drawn at `scale`: a labelled major every `niceStep`, minors between. */
export function rulerTicks(len: number, scale: number): { at: number; major: boolean; label?: string }[] {
  const major = niceStep(scale);
  const lead = major / Math.pow(10, Math.floor(Math.log10(major)));
  const minor = major / (lead === 2 ? 4 : 5);
  const out: { at: number; major: boolean; label?: string }[] = [];
  const n = Math.min(400, Math.floor(len / minor));
  for (let i = 0; i <= n; i++) {
    const at = Math.round(i * minor * 100) / 100;
    const isMajor = Math.abs(at / major - Math.round(at / major)) < 1e-6;
    out.push({ at, major: isMajor, ...(isMajor ? { label: String(Math.round(at)) } : {}) });
  }
  return out;
}

/** Where a pointer is on the page, in frame pixels along one axis (whole pixels; may fall outside the frame). */
export const framePos = (client: number, start: number, cssLen: number, frameLen: number) => Math.round(((client - start) / Math.max(cssLen, 1)) * frameLen);

/** Which safe-zone view fits a page by default: the story's bands on a tall one, the profile grid's on a taller-than-wide one, the link ad's sides on a wide one. */
export function autoSafeKind(frame: Frame): 'story' | 'feed-grid' | 'link' {
  if (frame.h >= 1800) return 'story';
  if (frame.w / frame.h >= 1.5) return 'link';
  return 'feed-grid';
}

// ── Selection, keyboard and zoom ───────────────────────────────────────────

/** The layer Tab moves to: the next (or, with `back`, the previous) one that is shown and not locked, wrapping round. */
export function cycleLayer(layers: { id: string; hidden?: boolean; locked?: boolean }[], current: string[], back = false): string | null {
  const ok = layers.filter(l => !l.hidden && !l.locked);
  if (!ok.length) return null;
  const at = current.length ? ok.findIndex(l => l.id === current[current.length - 1]) : -1;
  if (at < 0) return (back ? ok[ok.length - 1] : ok[0]).id;
  return ok[(at + (back ? -1 : 1) + ok.length) % ok.length].id;
}

export const ZOOM_LEVELS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3];
/** The next zoom level up (dir 1) or down (-1) from the current one. */
export function nextZoom(now: number, dir: 1 | -1): number {
  const hit = dir > 0 ? ZOOM_LEVELS.find(z => z > now + 0.001) : [...ZOOM_LEVELS].reverse().find(z => z < now - 0.001);
  return hit ?? (dir > 0 ? ZOOM_LEVELS[ZOOM_LEVELS.length - 1] : ZOOM_LEVELS[0]);
}

// ── Position numbers ───────────────────────────────────────────────────────

/** A width and height changed by one of them, keeping the shape when locked. */
export function sizeWith(cur: { w: number; h: number }, edit: { w?: number; h?: number }, lock: boolean): { w: number; h: number } {
  const ratio = cur.h > 0 && cur.w > 0 ? cur.w / cur.h : 1;
  let { w, h } = cur;
  if (edit.w !== undefined) { w = edit.w; if (lock) h = w / ratio; }
  else if (edit.h !== undefined) { h = edit.h; if (lock) w = h * ratio; }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

/**
 * Several boxes moved or sized as one: `to` is the union's new box (any of x, y, w, h). Each box keeps its place
 * inside the union in proportion, so a group edited by numbers behaves as one thing. Returns the new boxes.
 */
export function fitToUnion(boxes: Box[], union: Box, to: Partial<Box>): Box[] {
  const next: Box = { x: to.x ?? union.x, y: to.y ?? union.y, w: Math.max(1, to.w ?? union.w), h: Math.max(1, to.h ?? union.h) };
  const kx = union.w > 0 ? next.w / union.w : 1, ky = union.h > 0 ? next.h / union.h : 1;
  return boxes.map(b => ({ x: next.x + (b.x - union.x) * kx, y: next.y + (b.y - union.y) * ky, w: b.w * kx, h: b.h * ky }));
}

export type MatchHow = 'width' | 'height' | 'both' | 'x' | 'y' | 'position';
/** The nudges and scale factors that make the other boxes the same size or position as the reference (the first selected). */
export function matchTo(ref: Box, boxes: Box[], how: MatchHow): { dx: number; dy: number; kx: number; ky: number }[] {
  return boxes.map(b => {
    const kx = (how === 'width' || how === 'both') && b.w > 0 ? ref.w / b.w : 1;
    const ky = (how === 'height' || how === 'both') && b.h > 0 ? ref.h / b.h : 1;
    const dx = how === 'x' || how === 'position' ? ref.x - b.x : 0;
    const dy = how === 'y' || how === 'position' ? ref.y - b.y : 0;
    return { dx, dy, kx, ky };
  });
}

// ── History labels ─────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { text: 'text', wordmark: 'mark', image: 'photo', qr: 'QR code', arrow: 'arrow', line: 'line', rect: 'box', circle: 'circle', shape: 'shape' };
const KEY_LABEL: [string[], string][] = [
  [['x', 'y'], 'Moved'], [['w', 'h', 'width', 'size', 'iz', 'fx', 'fy'], 'Resized'], [['rotate'], 'Turned'], [['text'], 'Edited words'],
  [['runs', 'list'], 'Styled words'], [['fillGradient', 'fill', 'fill2'], 'Fill'], [['color', 'fg', 'autoColor', 'border'], 'Colour'], [['opacity'], 'Transparency'],
  [['font', 'upper', 'underline', 'spacing', 'lineHeight', 'align', 'curve'], 'Type'], [['effect', 'shadow', 'box'], 'Effect'], [['layerFx'], 'Effects'], [['blend'], 'Blend'],
  [['adjust', 'shade'], 'Photo adjust'], [['cutout'], 'Cut-out'], [['mask', 'radius'], 'Frame'], [['hidden'], 'Shown or hidden'], [['locked'], 'Locked or unlocked'],
  [['flipX', 'flipY'], 'Flipped'], [['group'], 'Grouped'], [['name'], 'Renamed'], [['value', 'bg', 'quiet'], 'QR code'], [['stroke', 'dash'], 'Line'],
];
const kindWord = (l: Layer) => l.name || KIND_LABEL[l.kind] || l.kind;
const sameVal = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

const BG_LABEL: [string[], string][] = [
  [['adjust'], 'Photo adjust'], [['placement'], 'Moved or zoomed the photo'], [['photoId'], 'Changed the photo'],
  [['shade', 'dim', 'gradient'], 'Shade over the photo'], [['fill', 'color', 'color2'], 'Background colour'],
];
/** What changed behind the layers. */
function describeBg(a: StoryDoc['bg'], b: StoryDoc['bg']): string {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed = [...keys].filter(k => !sameVal((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k]));
  for (const [ks, lab] of BG_LABEL) if (changed.some(k => ks.includes(k))) return lab;
  return 'Background';
}

/** A few words for what separates two snapshots of a design: "Moved headline", "Deleted 2 things", "Background"… */
export function describeChange(prev: StoryDoc, next: StoryDoc): string {
  const p = new Map(prev.layers.map(l => [l.id, l])), n = new Map(next.layers.map(l => [l.id, l]));
  const added = next.layers.filter(l => !p.has(l.id)), gone = prev.layers.filter(l => !n.has(l.id));
  if (added.length || gone.length) {
    if (added.length && !gone.length) return added.length === 1 ? `Added ${kindWord(added[0])}` : `Added ${added.length} things`;
    if (gone.length && !added.length) return gone.length === 1 ? `Deleted ${kindWord(gone[0])}` : `Deleted ${gone.length} things`;
    return 'Changed the layers';
  }
  const changed: { l: Layer; labels: string[] }[] = [];
  for (const l of next.layers) {
    const o = p.get(l.id)!;
    if (o === l) continue;
    const keys = new Set([...Object.keys(o), ...Object.keys(l)]);
    const labels: string[] = [];
    for (const k of keys) if (!sameVal((o as unknown as Record<string, unknown>)[k], (l as unknown as Record<string, unknown>)[k])) {
      const lab = KEY_LABEL.find(([ks]) => ks.includes(k))?.[1];
      if (lab && !labels.includes(lab)) labels.push(lab);
    }
    if (labels.length) changed.push({ l, labels });
  }
  if (changed.length === 1) {
    const [lab] = changed[0].labels;
    return lab.includes(' or ') ? `${lab}: ${kindWord(changed[0].l)}` : `${lab} ${kindWord(changed[0].l)}`;
  }
  if (changed.length > 1) return `${changed[0].labels[0]}, ${changed.length} things`;
  if (prev.layers.some((l, i) => l.id !== next.layers[i]?.id)) return 'Reordered layers';
  if (!sameVal(prev.meta?.guides, next.meta?.guides)) return 'Guides';
  if (!sameVal(prev.meta?.grid, next.meta?.grid)) return 'Grid';
  if (!sameVal(prev.bg, next.bg)) return describeBg(prev.bg, next.bg);
  if (!sameVal(prev.frame, next.frame)) return 'Page size';
  return 'Edit';
}
