/**
 * Flat image -> editable layers (plan §4.3), the pure part: what the vision call says is on a picture
 * (its lettering with boxes and a font class, where the subject is, how busy the background is), made safe,
 * and turned into designer layers. The route (/api/design/layers) does the calls; this is tested alone.
 * Never regenerates the jewellery: every pixel of the piece stays the user's own photo.
 */

import { newLayerId, newText, type Box01, type FontKey, type LayerRole, type TextLayer } from '@/lib/social/editor';

export type FontClass = 'sans' | 'condensed' | 'serif' | 'serif-italic' | 'script' | 'futura' | 'display';
export type TextWeight = 'light' | 'regular' | 'bold';
export const FONT_CLASSES: readonly FontClass[] = ['sans', 'condensed', 'serif', 'serif-italic', 'script', 'futura', 'display'];
export const TEXT_ROLES = ['headline', 'kicker', 'specs', 'cta', 'mark', 'badge', 'text'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];
export type PlateKind = 'clean' | 'textured' | 'busy';

export interface DetectedText { text: string; box: Box01; role: TextRole; fontClass: FontClass; weight: TextWeight; colour: string | null }
export interface Analysis {
  text: DetectedText[];
  subject: Box01 | null;
  background: PlateKind;
  /** ring, bangle, necklace set, earrings … as the vision call names it. */
  category: string;
  /** Lettering sits on the photograph itself. */
  burnedText: boolean;
  headline: string;
}

/** The font a detected class and weight map to. */
export function fontFor(fontClass: FontClass, weight: TextWeight = 'regular'): FontKey {
  switch (fontClass) {
    case 'condensed': return 'condensed';
    case 'serif': return weight === 'bold' ? 'playfair' : 'serif';
    case 'serif-italic': return 'serif-italic';
    case 'script': return 'script';
    case 'futura': return 'futura';
    case 'display': return 'cinzel';
    default: return weight === 'bold' ? 'bold' : weight === 'light' ? 'light' : 'regular';
  }
}

const num01 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : NaN);
/** A box as fractions of the frame, clamped inside it; null when it is nothing. */
export function cleanBox(raw: unknown): Box01 | null {
  const b = (raw ?? {}) as Record<string, unknown>;
  const x = num01(b.x), y = num01(b.y);
  let w = num01(b.w), h = num01(b.h);
  if ([x, y, w, h].some(Number.isNaN)) return null;
  w = Math.min(w, 1 - x); h = Math.min(h, 1 - y);
  return w >= 0.01 && h >= 0.005 ? { x, y, w, h } : null;
}

const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? v as T : fallback);
const HEX = /^#[0-9a-f]{6}$/i;

/** The vision call's answer, made safe. Null when it holds nothing usable. */
export function normalizeAnalysis(raw: unknown): Analysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text: DetectedText[] = [];
  for (const t of Array.isArray(r.text) ? r.text.slice(0, 24) : []) {
    const o = (t ?? {}) as Record<string, unknown>;
    const words = typeof o.text === 'string' ? o.text.replace(/[ \t]+/g, ' ').trim().slice(0, 160) : '';
    const box = cleanBox(o.box);
    if (!words || !box) continue;
    text.push({
      text: words, box,
      role: oneOf(o.role, TEXT_ROLES, 'text'),
      fontClass: oneOf(o.fontClass, FONT_CLASSES, 'sans'),
      weight: oneOf(o.weight, ['light', 'regular', 'bold'] as const, 'regular'),
      colour: typeof o.colour === 'string' && HEX.test(o.colour) ? o.colour.toUpperCase() : null,
    });
  }
  const subject = cleanBox(r.subject);
  if (!text.length && !subject) return null;
  return {
    text, subject,
    background: oneOf(r.background, ['clean', 'textured', 'busy'] as const, 'busy'),
    category: typeof r.category === 'string' ? r.category.trim().slice(0, 40) : '',
    burnedText: r.burnedText === true || text.length > 0,
    headline: typeof r.headline === 'string' ? r.headline.trim().slice(0, 120) : '',
  };
}

/** A detected piece of lettering as a text layer in a frame of `w` x `h`: placed by its box, sized by its height, never auto-coloured. */
export function textLayerOf(d: DetectedText, frame: { w: number; h: number }): TextLayer {
  const lines = Math.max(1, d.text.split('\n').length);
  const lineH = (d.box.h * frame.h) / lines;
  const size = Math.max(14, Math.round(lineH / 1.1));
  const cx = (d.box.x + d.box.w / 2) * frame.w;
  const role: LayerRole = d.role;
  return {
    ...newText(d.colour ?? '#FFFFFF'),
    id: newLayerId('text'),
    text: d.text, x: Math.round(cx), y: Math.round(d.box.y * frame.h),
    size, font: fontFor(d.fontClass, d.weight), color: d.colour ?? '#FFFFFF', align: 'center',
    width: Math.max(80, Math.round(d.box.w * frame.w * 1.05)),
    fit: true, lineHeight: 1.1, autoColor: false, role,
    upper: d.text.length > 3 && d.text === d.text.toUpperCase() && /[A-Z]/.test(d.text),
    name: d.role === 'text' ? undefined : d.role,
  };
}

export interface SplitPlan {
  layers: TextLayer[];
  subject: Box01 | null;
  /** How the picture will be made: the original with lettering as layers, and a cut-out when one could be made. */
  plate: 'original' | 'clean';
  /** What the review screen says, in words. */
  notes: string[];
}

/** The layers for the review screen: text layers (each with accept/skip in the page), the subject box for the resize. */
export function planSplit(a: Analysis, frame: { w: number; h: number }): SplitPlan {
  const layers = a.text.map(t => textLayerOf(t, frame));
  const notes: string[] = [];
  if (!layers.length) notes.push('No lettering found on the picture.');
  if (a.background === 'busy') notes.push('The background is busy; the lettering stays on the photograph until the cut-out is ready.');
  return { layers, subject: a.subject, plate: 'original', notes };
}

const BOX = { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' }, w: { type: 'NUMBER' }, h: { type: 'NUMBER' } }, required: ['x', 'y', 'w', 'h'] };
/** The vision call's schema and brief (used by /api/design/analyze and /api/design/layers). */
export const ANALYZE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    text: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' }, box: BOX,
          role: { type: 'STRING', enum: [...TEXT_ROLES] }, fontClass: { type: 'STRING', enum: [...FONT_CLASSES] },
          weight: { type: 'STRING', enum: ['light', 'regular', 'bold'] }, colour: { type: 'STRING' },
        },
        required: ['text', 'box', 'role', 'fontClass'],
      },
    },
    subject: BOX,
    background: { type: 'STRING', enum: ['clean', 'textured', 'busy'] },
    category: { type: 'STRING' },
    headline: { type: 'STRING' },
  },
  required: ['text', 'subject', 'background', 'category'],
};
export const ANALYZE_SYSTEM = `You read a finished picture of a piece of jewellery (a photograph, or an ad made from one) so it can be rebuilt as editable layers.
Boxes are fractions of the whole picture, 0 to 1: x and y the top-left corner, w and h the size.
text: every piece of lettering printed on the picture, copied exactly as it reads (same spelling, same figures, same case), one entry per block, with its box, its role (headline, kicker, specs for karat/weight/stone lines, cta, mark for a logo or wordmark, badge, text), the closest font class (sans, condensed, serif, serif-italic, script, futura, display), its weight, and its colour as #RRGGBB. Never add words that are not on the picture. No lettering: an empty list.
subject: the box around the jewellery itself, tight, excluding its stand or hand where you can.
background: clean (plain or soft gradient), textured, or busy.
category: ring, bangle, bracelet, necklace, necklace set, earrings, pendant, chain, set or other.
headline: a name of at most five words for the piece, no figures.`;


/** The layer splitter's switch (plan §6): on for the owner and marketing (the route's `designGate('ads')`), off for staff. */
export const DESIGN_LAYERS = true;
