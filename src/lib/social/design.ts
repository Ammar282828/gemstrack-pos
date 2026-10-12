/**
 * The designer's geometry and pixel work, kept free of the DOM so it can be
 * tested: shape outlines (also the frames photos are cut to), photo filters,
 * aligning and spacing a selection, and the magnetic guides a moving layer
 * snaps to.
 */

export interface Box { x: number; y: number; w: number; h: number }

// ── Shapes ─────────────────────────────────────────────────────────────────
// Each is an SVG path for a w × h box with its top-left at 0, 0, so one
// outline serves the canvas (new Path2D(d)), the element picker's previews
// and the frames a photo can be cut to.

export type ShapeKey =
  | 'triangle' | 'diamond' | 'gem' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'sparkle' | 'burst'
  | 'heart' | 'arch' | 'pill' | 'speech' | 'plus' | 'ribbon' | 'tag' | 'ellipse' | 'rounded';

const f = (n: number) => Math.round(n * 100) / 100;

function polygon(w: number, h: number, n: number, rot = -Math.PI / 2): string {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = rot + (i * 2 * Math.PI) / n;
    return `${f(w / 2 + (w / 2) * Math.cos(a))} ${f(h / 2 + (h / 2) * Math.sin(a))}`;
  });
  return `M ${pts.join(' L ')} Z`;
}

function star(w: number, h: number, points: number, inner: number): string {
  const pts = Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 ? inner : 1;
    return `${f(w / 2 + (w / 2) * r * Math.cos(a))} ${f(h / 2 + (h / 2) * r * Math.sin(a))}`;
  });
  return `M ${pts.join(' L ')} Z`;
}

function rounded(w: number, h: number, r: number): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M ${f(q)} 0 H ${f(w - q)} A ${f(q)} ${f(q)} 0 0 1 ${f(w)} ${f(q)} V ${f(h - q)} A ${f(q)} ${f(q)} 0 0 1 ${f(w - q)} ${f(h)} H ${f(q)} A ${f(q)} ${f(q)} 0 0 1 0 ${f(h - q)} V ${f(q)} A ${f(q)} ${f(q)} 0 0 1 ${f(q)} 0 Z`;
}

export const SHAPES: Record<ShapeKey, { label: string; path: (w: number, h: number) => string }> = {
  triangle: { label: 'Triangle', path: (w, h) => `M ${f(w / 2)} 0 L ${f(w)} ${f(h)} L 0 ${f(h)} Z` },
  diamond: { label: 'Diamond', path: (w, h) => `M ${f(w / 2)} 0 L ${f(w)} ${f(h / 2)} L ${f(w / 2)} ${f(h)} L 0 ${f(h / 2)} Z` },
  // A cut stone seen from the side: the table, the crown's shoulders and the pavilion's point.
  gem: { label: 'Gem', path: (w, h) => `M ${f(w * 0.25)} 0 L ${f(w * 0.75)} 0 L ${f(w)} ${f(h * 0.32)} L ${f(w / 2)} ${f(h)} L 0 ${f(h * 0.32)} Z` },
  pentagon: { label: 'Pentagon', path: (w, h) => polygon(w, h, 5) },
  hexagon: { label: 'Hexagon', path: (w, h) => polygon(w, h, 6, 0) },
  octagon: { label: 'Octagon', path: (w, h) => polygon(w, h, 8, Math.PI / 8) },
  star: { label: 'Star', path: (w, h) => star(w, h, 5, 0.5) },
  // The four-pointed glint ✦, its sides drawn in to the centre.
  sparkle: { label: 'Sparkle', path: (w, h) => `M ${f(w / 2)} 0 Q ${f(w / 2)} ${f(h / 2)} ${f(w)} ${f(h / 2)} Q ${f(w / 2)} ${f(h / 2)} ${f(w / 2)} ${f(h)} Q ${f(w / 2)} ${f(h / 2)} 0 ${f(h / 2)} Q ${f(w / 2)} ${f(h / 2)} ${f(w / 2)} 0 Z` },
  burst: { label: 'Badge', path: (w, h) => star(w, h, 16, 0.84) },
  heart: {
    label: 'Heart',
    path: (w, h) => `M ${f(w * 0.5)} ${f(h)} C ${f(w * 0.12)} ${f(h * 0.7)} 0 ${f(h * 0.45)} 0 ${f(h * 0.28)} C 0 ${f(h * 0.1)} ${f(w * 0.14)} 0 ${f(w * 0.28)} 0 C ${f(w * 0.4)} 0 ${f(w * 0.48)} ${f(h * 0.08)} ${f(w * 0.5)} ${f(h * 0.18)} C ${f(w * 0.52)} ${f(h * 0.08)} ${f(w * 0.6)} 0 ${f(w * 0.72)} 0 C ${f(w * 0.86)} 0 ${f(w)} ${f(h * 0.1)} ${f(w)} ${f(h * 0.28)} C ${f(w)} ${f(h * 0.45)} ${f(w * 0.88)} ${f(h * 0.7)} ${f(w * 0.5)} ${f(h)} Z`,
  },
  arch: { label: 'Arch', path: (w, h) => { const r = Math.min(w / 2, h); return `M 0 ${f(h)} V ${f(r)} A ${f(w / 2)} ${f(r)} 0 0 1 ${f(w)} ${f(r)} V ${f(h)} Z`; } },
  pill: { label: 'Pill', path: (w, h) => rounded(w, h, Math.min(w, h) / 2) },
  speech: {
    label: 'Speech',
    path: (w, h) => {
      const b = h * 0.8, r = Math.min(w, b) * 0.14;
      return `M ${f(r)} 0 H ${f(w - r)} Q ${f(w)} 0 ${f(w)} ${f(r)} V ${f(b - r)} Q ${f(w)} ${f(b)} ${f(w - r)} ${f(b)} H ${f(w * 0.42)} L ${f(w * 0.2)} ${f(h)} L ${f(w * 0.26)} ${f(b)} H ${f(r)} Q 0 ${f(b)} 0 ${f(b - r)} V ${f(r)} Q 0 0 ${f(r)} 0 Z`;
    },
  },
  plus: { label: 'Plus', path: (w, h) => `M ${f(w * 0.36)} 0 H ${f(w * 0.64)} V ${f(h * 0.36)} H ${f(w)} V ${f(h * 0.64)} H ${f(w * 0.64)} V ${f(h)} H ${f(w * 0.36)} V ${f(h * 0.64)} H 0 V ${f(h * 0.36)} H ${f(w * 0.36)} Z` },
  ribbon: { label: 'Banner', path: (w, h) => `M 0 0 H ${f(w)} L ${f(w * 0.93)} ${f(h / 2)} L ${f(w)} ${f(h)} H 0 L ${f(w * 0.07)} ${f(h / 2)} Z` },
  // A swing tag, pointed at the left where the string would go.
  tag: { label: 'Tag', path: (w, h) => `M 0 ${f(h / 2)} L ${f(Math.min(w * 0.2, h / 2))} 0 H ${f(w)} V ${f(h)} H ${f(Math.min(w * 0.2, h / 2))} Z` },
  ellipse: { label: 'Circle', path: (w, h) => `M 0 ${f(h / 2)} A ${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)} A ${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)} Z` },
  rounded: { label: 'Rounded', path: (w, h) => rounded(w, h, Math.min(w, h) * 0.12) },
};

/** The shapes the Elements panel offers, in its order (circle and box are the editor's own kinds). */
export const SHAPE_PICKS: ShapeKey[] = ['triangle', 'diamond', 'gem', 'star', 'sparkle', 'heart', 'hexagon', 'pentagon', 'octagon', 'arch', 'pill', 'burst', 'ribbon', 'tag', 'speech', 'plus'];
/** The outlines a photo can be framed in. */
export type MaskKey = 'rounded' | 'ellipse' | 'arch' | 'heart' | 'star' | 'hexagon' | 'diamond' | 'sparkle' | 'gem' | 'pill';
export const MASK_PICKS: MaskKey[] = ['ellipse', 'arch', 'rounded', 'pill', 'heart', 'hexagon', 'diamond', 'gem', 'star', 'sparkle'];

// ── Photo filters ──────────────────────────────────────────────────────────

/** Every value −100…100 (fade and vignette 0…100); all zero leaves the photo as it is. */
export interface Adjust {
  brightness: number; contrast: number; saturation: number; warmth: number; fade: number; vignette: number;
  /**
   * Designer v2 (missing = 0). highlights/shadows −100…100 (shadows + lifts the dark, highlights − recovers glare),
   * tint −100…100 (− green, + magenta), hue −100…100 (±180°), sharpen / blur / grain 0…100.
   * Blur and sharpen are relative to the picture's size, so a preview and a full-size export look alike.
   */
  highlights?: number; shadows?: number; tint?: number; hue?: number; sharpen?: number; blur?: number; grain?: number;
}
export const NO_ADJUST: Adjust = { brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0 };
export const isPlain = (a: Adjust | null | undefined): boolean =>
  !a || (!a.brightness && !a.contrast && !a.saturation && !a.warmth && !a.fade && !a.vignette
    && !a.highlights && !a.shadows && !a.tint && !a.hue && !a.sharpen && !a.blur && !a.grain);
/** Whether the pixels themselves change (the vignette is drawn over them instead). */
export const changesPixels = (a: Adjust | null | undefined): boolean => !!a && !isPlain({ ...a, vignette: 0 });

export const FILTERS: { id: string; label: string; adjust: Adjust }[] = [
  { id: 'original', label: 'Original', adjust: NO_ADJUST },
  { id: 'bright', label: 'Bright', adjust: { ...NO_ADJUST, brightness: 12, contrast: 8, saturation: 6 } },
  { id: 'golden', label: 'Golden', adjust: { ...NO_ADJUST, warmth: 42, saturation: 14, contrast: 10, brightness: 5 } },
  { id: 'honey', label: 'Honey', adjust: { ...NO_ADJUST, warmth: 26, saturation: 8, brightness: 4 } },
  { id: 'crisp', label: 'Crisp', adjust: { ...NO_ADJUST, contrast: 24, saturation: 10, brightness: 2 } },
  { id: 'vivid', label: 'Vivid', adjust: { ...NO_ADJUST, saturation: 34, contrast: 16 } },
  { id: 'cool', label: 'Cool', adjust: { ...NO_ADJUST, warmth: -26, saturation: -4, brightness: 3 } },
  { id: 'soft', label: 'Soft', adjust: { ...NO_ADJUST, contrast: -16, fade: 18, brightness: 6 } },
  { id: 'vintage', label: 'Vintage', adjust: { ...NO_ADJUST, fade: 34, saturation: -20, warmth: 14 } },
  { id: 'mono', label: 'Mono', adjust: { ...NO_ADJUST, saturation: -100, contrast: 12 } },
  { id: 'noir', label: 'Noir', adjust: { ...NO_ADJUST, saturation: -100, contrast: 40, brightness: -8, vignette: 45 } },
  { id: 'spotlight', label: 'Spotlight', adjust: { ...NO_ADJUST, contrast: 10, vignette: 60 } },
];

/**
 * The designer's photo filters applied to RGBA pixels in place. Plain arithmetic rather than ctx.filter, which
 * Safari on the counter's iPhones doesn't draw. Brightness, contrast, saturation, warmth and fade come first
 * (unchanged since they were written), then highlights, shadows, tint and hue per pixel, then — when the
 * picture's `w` × `h` is given — blur, sharpen (an unsharp mask) and grain. Every new control at 0 (or missing)
 * leaves the pixels exactly as the older arithmetic made them.
 */
export function applyAdjust(d: Uint8ClampedArray, a: Adjust, w?: number, h?: number): void {
  const br = a.brightness / 100, sat = 1 + a.saturation / 100, warm = a.warmth / 100, fade = a.fade / 100;
  const C = a.contrast * 1.28;
  const cf = (259 * (C + 255)) / (255 * (259 - C));
  const hi = (a.highlights ?? 0) / 100, sh = (a.shadows ?? 0) / 100, tint = (a.tint ?? 0) / 100, hue = (a.hue ?? 0) * 1.8;
  const tonal = !!(hi || sh), tinted = !!tint, turned = !!hue;
  const rot = hueMatrix(hue);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (br) { r = r * (1 + br * 0.45) + br * 40; g = g * (1 + br * 0.45) + br * 40; b = b * (1 + br * 0.45) + br * 40; }
    if (C) { r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128; }
    if (sat !== 1) { const y = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = y + (r - y) * sat; g = y + (g - y) * sat; b = y + (b - y) * sat; }
    if (warm) { r += 28 * warm; g += 7 * warm; b -= 28 * warm; }
    if (fade) { r = r * (1 - 0.28 * fade) + 34 * fade; g = g * (1 - 0.28 * fade) + 32 * fade; b = b * (1 - 0.28 * fade) + 30 * fade; }
    if (tonal) {
      const y = Math.min(1, Math.max(0, (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255));
      const lift = sh * 70 * (1 - y) * (1 - y) + hi * 70 * y * y;
      r += lift; g += lift; b += lift;
    }
    if (tinted) { r += 8 * tint; g -= 24 * tint; b += 8 * tint; }
    if (turned) {
      const r0 = r, g0 = g, b0 = b;
      r = rot[0] * r0 + rot[1] * g0 + rot[2] * b0;
      g = rot[3] * r0 + rot[4] * g0 + rot[5] * b0;
      b = rot[6] * r0 + rot[7] * g0 + rot[8] * b0;
    }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; // Uint8ClampedArray clamps and rounds
  }
  if (!w || !h || w * h * 4 !== d.length) return; // the spatial controls need the picture's shape
  const long = Math.max(w, h);
  const blur = Math.min(100, Math.max(0, a.blur ?? 0));
  if (blur) boxBlurRGBA(d, w, h, Math.max(1, Math.round(((blur / 100) * 0.025 * long) / 1.5)), 3);
  const sharpen = Math.min(100, Math.max(0, a.sharpen ?? 0));
  if (sharpen) unsharp(d, w, h, Math.max(1, Math.round(0.003 * long)), (sharpen / 100) * 1.6);
  const grain = Math.min(100, Math.max(0, a.grain ?? 0));
  if (grain) addGrain(d, (grain / 100) * 38);
}

/** CSS's hue-rotate matrix (row-major 3 × 3) for an angle in degrees. */
function hueMatrix(deg: number): number[] {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

/**
 * A box blur of radius r over all four channels, repeated `passes` times (three approximate a Gaussian). Each
 * pass is two running sums, so the cost is linear in the pixels however large r is. Edges repeat their last
 * pixel. In place.
 */
export function boxBlurRGBA(d: Uint8ClampedArray, w: number, h: number, r: number, passes = 1): void {
  if (r < 1 || w < 1 || h < 1) return;
  const tmp = new Uint8ClampedArray(d.length);
  for (let p = 0; p < passes; p++) {
    blurAxis(d, tmp, w, h, r, 4, w * 4); // along each row
    blurAxis(tmp, d, h, w, r, w * 4, 4); // down each column
  }
}
function blurAxis(src: Uint8ClampedArray, dst: Uint8ClampedArray, len: number, lines: number, r: number, step: number, lineStep: number): void {
  const div = 2 * r + 1, half = div >> 1;
  for (let line = 0; line < lines; line++) {
    const base = line * lineStep;
    for (let c = 0; c < 4; c++) {
      const at = (i: number) => base + (i < 0 ? 0 : i >= len ? len - 1 : i) * step + c;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[at(i)];
      for (let i = 0; i < len; i++) {
        dst[base + i * step + c] = Math.floor((sum + half) / div);
        sum += src[at(i + r + 1)] - src[at(i - r)];
      }
    }
  }
}

/** Sharpen by an unsharp mask: the picture plus `amount` × (the picture − its blur). Alpha is left alone. In place. */
export function unsharp(d: Uint8ClampedArray, w: number, h: number, r: number, amount: number): void {
  if (!amount) return;
  const soft = d.slice();
  boxBlurRGBA(soft, w, h, r, 3);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = d[i] + amount * (d[i] - soft[i]);
    d[i + 1] = d[i + 1] + amount * (d[i + 1] - soft[i + 1]);
    d[i + 2] = d[i + 2] + amount * (d[i + 2] - soft[i + 2]);
  }
}

/** Film grain: one random-looking amount (± `amp` levels) added to all three channels, fixed per pixel so a redraw looks the same. In place. */
export function addGrain(d: Uint8ClampedArray, amp: number): void {
  for (let i = 0; i < d.length; i += 4) {
    // An integer hash of the pixel's index, mapped to −1…1.
    let x = (i >>> 2) + 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b); x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35); x ^= x >>> 16;
    const v = (((x >>> 0) / 4294967295) * 2 - 1) * amp;
    d[i] = d[i] + v; d[i + 1] = d[i + 1] + v; d[i + 2] = d[i + 2] + v;
  }
}

// ── Aligning and spacing ───────────────────────────────────────────────────

export type AlignHow = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const r = Math.max(...boxes.map(b => b.x + b.w)), btm = Math.max(...boxes.map(b => b.y + b.h));
  return { x, y, w: r - x, h: btm - y };
}

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * How far each box moves to line up. With `to` (the page) every box lines up
 * with it; otherwise they line up with the edge of the whole selection, as
 * Canva does with several elements picked.
 */
export function alignDeltas(boxes: Box[], how: AlignHow, to?: Box): { dx: number; dy: number }[] {
  const t = to ?? unionBox(boxes);
  return boxes.map(b => {
    switch (how) {
      case 'left': return { dx: t.x - b.x, dy: 0 };
      case 'center': return { dx: t.x + t.w / 2 - (b.x + b.w / 2), dy: 0 };
      case 'right': return { dx: t.x + t.w - (b.x + b.w), dy: 0 };
      case 'top': return { dx: 0, dy: t.y - b.y };
      case 'middle': return { dx: 0, dy: t.y + t.h / 2 - (b.y + b.h / 2) };
      case 'bottom': return { dx: 0, dy: t.y + t.h - (b.y + b.h) };
    }
  });
}

/** Equal gaps between three or more boxes, the outermost two staying put. */
export function distributeDeltas(boxes: Box[], axis: 'h' | 'v'): { dx: number; dy: number }[] {
  const out = boxes.map(() => ({ dx: 0, dy: 0 }));
  if (boxes.length < 3) return out;
  const pos = (b: Box) => (axis === 'h' ? b.x : b.y), size = (b: Box) => (axis === 'h' ? b.w : b.h);
  const order = boxes.map((b, i) => i).sort((i, j) => pos(boxes[i]) - pos(boxes[j]));
  const first = boxes[order[0]], last = boxes[order[order.length - 1]];
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - order.reduce((s, i) => s + size(boxes[i]), 0)) / (order.length - 1);
  let at = pos(first);
  for (const i of order) {
    const move = at - pos(boxes[i]);
    out[i] = axis === 'h' ? { dx: move, dy: 0 } : { dx: 0, dy: move };
    at += size(boxes[i]) + gap;
  }
  return out;
}

// ── Magnetic guides ────────────────────────────────────────────────────────

export interface SnapLines { xs: number[]; ys: number[] }
export interface SnapExtras {
  /** A grid every this many pixels (0 or missing: none). */
  grid?: number;
  /** The user's own guides (`doc.meta.guides`). */
  guides?: { x?: number[]; y?: number[] };
}

/**
 * Where a moving box may snap: the page's centre and margins, the edges and centres of everything else, and —
 * when asked — a grid and the user's guides.
 */
export function snapLines(frame: { w: number; h: number }, margin: number, others: Box[], extra: SnapExtras = {}): SnapLines {
  const xs = [frame.w / 2, margin, frame.w - margin], ys = [frame.h / 2, margin, frame.h - margin];
  for (const b of others) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  const grid = extra.grid && extra.grid >= 4 ? extra.grid : 0;
  if (grid) {
    for (let x = grid; x < frame.w && xs.length < 600; x += grid) xs.push(x);
    for (let y = grid; y < frame.h && ys.length < 600; y += grid) ys.push(y);
  }
  for (const g of extra.guides?.x ?? []) if (Number.isFinite(g)) xs.push(g);
  for (const g of extra.guides?.y ?? []) if (Number.isFinite(g)) ys.push(g);
  return { xs, ys };
}

/**
 * The nudge that brings the nearest of a box's edges or centre onto a line
 * within `threshold`, on each axis, and the line it snapped to (for the guide).
 */
export function snapBox(b: Box, lines: SnapLines, threshold: number): { dx: number; dy: number; v: number | null; h: number | null } {
  const best = (edges: number[], targets: number[]) => {
    let d = Infinity, at: number | null = null;
    for (const e of edges) for (const t of targets) if (Math.abs(t - e) < Math.abs(d) && Math.abs(t - e) <= threshold) { d = t - e; at = t; }
    return { d: at === null ? 0 : d, at };
  };
  const x = best([b.x, b.x + b.w / 2, b.x + b.w], lines.xs);
  const y = best([b.y, b.y + b.h / 2, b.y + b.h], lines.ys);
  return { dx: x.d, dy: y.d, v: x.at, h: y.at };
}

/**
 * A gap drawn between two boxes while spacing is equal. `axis: 'x'` is a horizontal gap from `a` to `b` (x
 * positions) at height `at`; `axis: 'y'` a vertical one at x = `at`. `gap` is the distance to show.
 */
export interface SpacingGuide { axis: 'x' | 'y'; a: number; b: number; at: number; gap: number }

const overlapY = (p: Box, q: Box) => p.y < q.y + q.h && q.y < p.y + p.h;
const overlapX = (p: Box, q: Box) => p.x < q.x + q.w && q.x < p.x + p.w;

/**
 * Canva's equal-spacing guides, on one axis. Among the boxes that sit level with the moving one (they overlap
 * it on the other axis) it finds where the box would (a) sit exactly midway between two of them, or (b) repeat
 * the gap between two neighbours, just past either end of the pair. Returns the nudge to get there (within
 * `threshold`) and the gaps to draw, or none.
 */
export function spacingSnap(b: Box, others: Box[], threshold: number, axis: 'x' | 'y'): { d: number; guides: SpacingGuide[] } {
  const x = axis === 'x';
  const pos = (p: Box) => (x ? p.x : p.y), len = (p: Box) => (x ? p.w : p.h);
  const level = others.filter(o => (x ? overlapY(o, b) : overlapX(o, b))).sort((p, q) => pos(p) - pos(q));
  const mid = (p: Box) => (x ? p.y + p.h / 2 : p.x + p.w / 2);
  type Cand = { d: number; guides: SpacingGuide[] };
  const cands: Cand[] = [];
  const guide = (from: number, to: number, ref: Box): SpacingGuide => ({ axis, a: from, b: to, at: mid(ref), gap: to - from });
  // (a) between two boxes: the gaps either side of the moving box made equal.
  for (let i = 0; i < level.length; i++) for (let j = i + 1; j < level.length; j++) {
    const left = level[i], right = level[j];
    const gapL = pos(b) - (pos(left) + len(left)), gapR = pos(right) - (pos(b) + len(b));
    if (gapL < 0 || gapR < 0) continue;
    const d = (gapR - gapL) / 2;
    if (Math.abs(d) <= threshold) {
      const gap = (gapL + gapR) / 2;
      cands.push({ d, guides: [guide(pos(left) + len(left), pos(left) + len(left) + gap, b), guide(pos(right) - gap, pos(right), b)] });
    }
  }
  // (b) repeating the gap of a neighbouring pair, after it or before it.
  for (let i = 0; i + 1 < level.length; i++) {
    const p = level[i], q = level[i + 1];
    const gap = pos(q) - (pos(p) + len(p));
    if (gap <= 0) continue;
    const after = pos(q) + len(q) + gap, before = pos(p) - gap - len(b);
    if (Math.abs(pos(b) - after) <= threshold && pos(b) >= pos(q) + len(q) - 0.5) cands.push({ d: after - pos(b), guides: [guide(pos(p) + len(p), pos(q), b), guide(pos(q) + len(q), after, b)] });
    if (Math.abs(pos(b) - before) <= threshold && pos(b) + len(b) <= pos(p) + 0.5) cands.push({ d: before - pos(b), guides: [guide(before + len(b), pos(p), b), guide(pos(p) + len(p), pos(q), b)] });
  }
  if (!cands.length) return { d: 0, guides: [] };
  return cands.reduce((best, c) => (Math.abs(c.d) < Math.abs(best.d) ? c : best));
}

/**
 * `snapBox` plus equal spacing: lines win on an axis where one is within reach, equal spacing fills in where
 * none is. `spacing` lists the gaps to draw, each with its distance.
 */
export function snapMove(b: Box, lines: SnapLines, others: Box[], threshold: number): { dx: number; dy: number; v: number | null; h: number | null; spacing: SpacingGuide[] } {
  const s = snapBox(b, lines, threshold);
  let { dx, dy } = s;
  const spacing: SpacingGuide[] = [];
  if (s.v === null) {
    const e = spacingSnap(b, others, threshold, 'x');
    if (e.guides.length) { dx = e.d; spacing.push(...e.guides); }
  }
  if (s.h === null) {
    const e = spacingSnap(b, others, threshold, 'y');
    if (e.guides.length) { dy = e.d; spacing.push(...e.guides); }
  }
  return { dx, dy, v: s.v, h: s.h, spacing };
}
