/**
 * Gradients for the designer (docs/features/design-studio-plan.md §2.5): linear (at any angle) and radial, with
 * any number of stops, each with its own opacity. One definition serves text fills, shape fills and the
 * background; the maths is pure (no DOM) apart from `makeGradient`, which only calls the context it is given.
 *
 * Angles are CSS degrees, as the photo shade's are: 180 runs top to bottom, 90 left to right, 0 bottom to top.
 */

import type { Gradient } from './editor';

type Ctx = CanvasRenderingContext2D;
export interface GBox { x: number; y: number; w: number; h: number }
export interface Rgba { r: number; g: number; b: number; a: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** "#rgb", "#rrggbb", "#rrggbbaa", "rgb(…)" or "rgba(…)" as numbers; null for anything else (names, hsl). */
export function parseColor(c: string): Rgba | null {
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) { const [r, g, b] = [...m[1]].map(ch => parseInt(ch + ch, 16)); return { r, g, b, a: 1 }; }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) { const n = parseInt(m[1], 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 }; }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  return null;
}

/** The colour at an extra opacity (multiplying any it has). Left as it is when nothing changes or it can't be read. */
export function colorWithAlpha(c: string, alpha?: number): string {
  if (alpha === undefined || alpha >= 1) return c;
  const p = parseColor(c);
  if (!p) return c;
  return `rgba(${Math.round(p.r)},${Math.round(p.g)},${Math.round(p.b)},${Math.round(clamp01(p.a * Math.max(0, alpha)) * 1000) / 1000})`;
}

export const isGradient = (v: unknown): v is Gradient =>
  !!v && typeof v === 'object' && ((v as Gradient).type === 'linear' || (v as Gradient).type === 'radial') && Array.isArray((v as Gradient).stops);

/**
 * A gradient that is safe to draw: stops with finite positions clamped to 0…1 and sorted (equal positions keep
 * their order), opacities clamped, at least two stops, a finite angle.
 */
export function normalizeGradient(g: Gradient): Gradient {
  const stops = (Array.isArray(g.stops) ? g.stops : [])
    .filter(s => s && typeof s.color === 'string' && Number.isFinite(s.at))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => clamp01(a.s.at) - clamp01(b.s.at) || a.i - b.i)
    .map(({ s }) => ({ at: clamp01(s.at), color: s.color, ...(s.alpha !== undefined && Number.isFinite(s.alpha) ? { alpha: clamp01(s.alpha) } : {}) }));
  if (stops.length === 0) stops.push({ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' });
  else if (stops.length === 1) stops.push({ ...stops[0], at: stops[0].at < 1 ? 1 : 0 }), stops.sort((a, b) => a.at - b.at);
  return { type: g.type === 'radial' ? 'radial' : 'linear', angle: Number.isFinite(g.angle) ? g.angle : 180, stops };
}

/** The line a linear gradient runs along inside a box: through the centre, corner to corner, at the angle. */
export function gradientLine(g: Gradient, b: GBox): { x0: number; y0: number; x1: number; y1: number } {
  const a = (g.angle * Math.PI) / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(b.w * dx) + Math.abs(b.h * dy)) / 2, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** A canvas gradient over a box. Radial ones start at the centre and end at the farthest corner. */
export function makeGradient(ctx: Ctx, gradient: Gradient, b: GBox): CanvasGradient {
  const g = normalizeGradient(gradient);
  let out: CanvasGradient;
  if (g.type === 'radial') {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    out = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, Math.hypot(b.w, b.h) / 2));
  } else {
    const l = gradientLine(g, b);
    out = ctx.createLinearGradient(l.x0, l.y0, l.x1, l.y1);
  }
  for (const s of g.stops) out.addColorStop(s.at, colorWithAlpha(s.color, s.alpha));
  return out;
}

/** The same gradient as CSS, for the panel's swatches and previews. */
export function gradientCss(gradient: Gradient): string {
  const g = normalizeGradient(gradient);
  const stops = g.stops.map(s => `${colorWithAlpha(s.color, s.alpha)} ${Math.round(s.at * 1000) / 10}%`).join(', ');
  return g.type === 'radial' ? `radial-gradient(circle farthest-corner, ${stops})` : `linear-gradient(${Math.round(g.angle * 100) / 100}deg, ${stops})`;
}

/** The colour a gradient has at position t along it (0…1), by blending the two stops around it. Null if a colour can't be read. */
export function gradientAt(gradient: Gradient, t: number): Rgba | null {
  const g = normalizeGradient(gradient);
  const x = clamp01(t);
  const col = (s: Gradient['stops'][number]): Rgba | null => { const p = parseColor(s.color); return p ? { ...p, a: p.a * (s.alpha ?? 1) } : null; };
  let lo = g.stops[0], hi = g.stops[g.stops.length - 1];
  for (let i = 0; i < g.stops.length - 1; i++) if (x >= g.stops[i].at && x <= g.stops[i + 1].at) { lo = g.stops[i]; hi = g.stops[i + 1]; break; }
  const a = col(lo), b = col(hi);
  if (!a || !b) return null;
  if (x <= lo.at || hi.at === lo.at) return a;
  const k = (x - lo.at) / (hi.at - lo.at);
  const mix = (p: number, q: number) => p + (q - p) * k;
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b), a: mix(a.a, b.a) };
}

/** Two colours, one angle. */
export const simpleGradient = (from: string, to: string, angle = 180): Gradient => ({ type: 'linear', angle, stops: [{ at: 0, color: from }, { at: 1, color: to }] });
/** The same gradient running the other way. */
export const reverseGradient = (g: Gradient): Gradient => ({ ...g, stops: g.stops.map(s => ({ ...s, at: 1 - s.at })).reverse() });
/** A yellow-gold foil, for headlines and shapes. */
export const GOLD_FOIL: Gradient = {
  type: 'linear', angle: 100,
  stops: [{ at: 0, color: '#8C6A25' }, { at: 0.3, color: '#E9C979' }, { at: 0.5, color: '#FBEFC4' }, { at: 0.7, color: '#C9973F' }, { at: 1, color: '#7A5A1E' }],
};
/** A rose-gold foil. */
export const ROSE_FOIL: Gradient = {
  type: 'linear', angle: 100,
  stops: [{ at: 0, color: '#8E5B4B' }, { at: 0.35, color: '#EBB8A0' }, { at: 0.55, color: '#FBE3D4' }, { at: 0.8, color: '#C4856C' }, { at: 1, color: '#7C4A3C' }],
};
/** A silver foil, for House of Mina. */
export const SILVER_FOIL: Gradient = {
  type: 'linear', angle: 100,
  stops: [{ at: 0, color: '#7C7F86' }, { at: 0.3, color: '#E3E5EA' }, { at: 0.5, color: '#FAFAFC' }, { at: 0.72, color: '#B4B8C0' }, { at: 1, color: '#6E7178' }],
};

/** What is wrong with a gradient from outside, in words (null when it is fine). */
export function gradientProblem(v: unknown): string | null {
  if (!v || typeof v !== 'object') return 'a gradient is not an object';
  const g = v as Partial<Gradient>;
  if (g.type !== 'linear' && g.type !== 'radial') return 'a gradient’s type is not linear or radial';
  if (typeof g.angle !== 'number' || !Number.isFinite(g.angle)) return 'a gradient’s angle is not a number';
  if (!Array.isArray(g.stops) || g.stops.length < 2 || g.stops.length > 8) return 'a gradient needs 2 to 8 stops';
  for (const s of g.stops) {
    if (!s || typeof s !== 'object') return 'a gradient stop is not an object';
    if (typeof s.at !== 'number' || !Number.isFinite(s.at) || s.at < 0 || s.at > 1) return 'a gradient stop’s position is not between 0 and 1';
    if (typeof s.color !== 'string' || !s.color || s.color.length > 40) return 'a gradient stop has no colour';
    if (s.alpha !== undefined && (typeof s.alpha !== 'number' || !Number.isFinite(s.alpha) || s.alpha < 0 || s.alpha > 1)) return 'a gradient stop’s opacity is not between 0 and 1';
  }
  return null;
}
