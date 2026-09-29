/**
 * Ad formats and Taheri's ad layouts for the studio's maker (the Post a Piece designer,
 * framed at Meta's sizes).
 *
 * Every frame is 1080 units wide (the designer's element sizes and limits assume it) and
 * exported at Meta's pixel width: 1:1 1080², 4:5 1080×1350, 9:16 1080×1920, and the
 * link format at 1200×628 (drawn as 1080×565).
 *
 * The layouts follow the vault's Visual Production and Logos notes: the dark ground and
 * gold, a fine gold corner-accent frame, bone (not white) type, a Didone for the words
 * that matter, one mark per surface, the monogram low and quiet on a product photograph.
 * In stories and reels nothing that must be read sits in the top 14% or the bottom 35%,
 * where Instagram draws its own buttons (`safeZone`). The words are the doc's bound fields:
 * headline (the piece's line), kicker (a small line above it) and details (the soft call
 * to action). Laying a template down replaces the last template's layers and keeps
 * anything the owner added.
 */

import { reflow, textLayer, newCornerMark, newLayerId, frameOf, type Assets, type Fields, type ImageLayer, type Layer, type ShapeLayer, type StoryDoc } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import type { Placement } from './assessment';
import { VISUAL } from './brand';

export type AdFormat = 'square' | 'portrait' | 'story' | 'landscape';
export const AD_FORMATS: Record<AdFormat, { label: string; short: string; frame: Frame; px: number; placement: Placement; where: string }> = {
  portrait: { label: 'Feed 4:5', short: '4:5', frame: { w: 1080, h: 1350 }, px: 1080, placement: 'portrait', where: 'Instagram and Facebook feeds — the largest a feed ad can be' },
  square: { label: 'Feed 1:1', short: '1:1', frame: { w: 1080, h: 1080 }, px: 1080, placement: 'square', where: 'Feeds, the right column, Marketplace' },
  story: { label: 'Stories & reels 9:16', short: '9:16', frame: { w: 1080, h: 1920 }, px: 1080, placement: 'story', where: 'Stories and reels, full screen' },
  landscape: { label: 'Link 1.91:1', short: '1.91:1', frame: { w: 1080, h: 565 }, px: 1200, placement: 'square', where: 'Facebook link ads and search' },
};
export const AD_FORMAT_ORDER: AdFormat[] = ['portrait', 'square', 'story', 'landscape'];
export const formatOfFrame = (f: Frame): AdFormat =>
  f.h >= 1800 ? 'story' : f.h >= 1300 ? 'portrait' : f.h <= 700 ? 'landscape' : 'square';

/** Where Instagram draws over a story or reel: keep what must be read out of these bands. */
export function safeZone(f: Frame): { top: number; bottom: number } {
  return f.h >= 1800 ? { top: Math.round(f.h * 0.14), bottom: Math.round(f.h * 0.35) } : { top: 0, bottom: 0 };
}

export type AdTemplateId = 'clean' | 'headline' | 'framed' | 'heritage' | 'band' | 'certified';
export const AD_TEMPLATES: { id: AdTemplateId; label: string; note: string }[] = [
  { id: 'clean', label: 'The photo, quietly marked', note: 'The piece alone; the monogram low in a corner.' },
  { id: 'headline', label: 'Headline on the photo', note: 'A line in the Didone over a soft shade, the call to action beneath.' },
  { id: 'framed', label: 'Framed on the house ground', note: 'The photo inset on the dark ground in a fine gold frame.' },
  { id: 'heritage', label: 'Since 1989', note: 'The piece in an arch, the house’s year above, the wordmark below.' },
  { id: 'band', label: 'Conversation band', note: 'A dark band with the line and a soft invitation to message.' },
  { id: 'certified', label: 'Certified diamonds', note: 'HRD Antwerp certified, the one spec the house names.' },
];

export const PHOTO = 'photo';
const TPL = 'template';
const { gold: GOLD, lightGold: LIGHT_GOLD, bone: BONE, ground: GROUND } = VISUAL;

const mine = <T extends Layer>(l: T): T => ({ ...l, name: TPL });
const isTemplate = (l: Layer) => l.name === TPL || (l.kind === 'text' && !!l.bind) || l.kind === 'wordmark';

function line(x: number, y: number, w: number, h: number, color = GOLD, stroke = 3): ShapeLayer {
  return { id: newLayerId('line'), kind: 'line', x, y, w, h, color, stroke, fill: null, curve: 0, radius: 0, rotate: 0, opacity: 1, name: TPL };
}
/** The fine gold corner-accent frame (Visual Production), `inset` from the edges. */
function corners(f: Frame, inset: number, len = 64, color = GOLD): ShapeLayer[] {
  const l = inset, r = f.w - inset, t = inset, b = f.h - inset;
  return [
    line(l, t, len, 0, color), line(l, t, 0, len, color),
    line(r - len, t, len, 0, color), line(r, t, 0, len, color),
    line(l, b, len, 0, color), line(l, b - len, 0, len, color),
    line(r - len, b, len, 0, color), line(r, b - len, 0, len, color),
  ];
}
function rect(x: number, y: number, w: number, h: number, fill: string, opacity = 1, fill2?: string): ShapeLayer {
  return { id: newLayerId('rect'), kind: 'rect', x, y, w, h, color: fill, stroke: 0, fill, fill2: fill2 ?? null, curve: 0, radius: 0, rotate: 0, opacity, name: TPL };
}
function photoLayer(x: number, y: number, w: number, h: number, extra: Partial<ImageLayer> = {}): ImageLayer {
  return { id: newLayerId('image'), kind: 'image', photoId: PHOTO, x, y, w, h, fx: 0.5, fy: 0.5, radius: 0, border: null, shadow: false, rotate: 0, opacity: 1, name: TPL, ...extra };
}
/** A mark sized by width, placed by its top-left. */
function mark(kind: 'wordmark' | 't', a: Assets, f: Frame, x: number, y: number, width: number, color = BONE, opacity = 1): Layer {
  const m = newCornerMark(kind === 't' && !a.marks.t ? 'wordmark' : kind, a, f);
  return { ...m, x, y, width, color, autoColor: false, opacity };
}
const markHeight = (kind: 'wordmark' | 't', a: Assets, width: number) => {
  const img = a.marks[kind] ?? a.marks.wordmark;
  return width * (img?.naturalWidth ? img.naturalHeight / img.naturalWidth : kind === 't' ? 2 : 0.25);
};

/** The words, stacked from `top`, centred (or left-aligned from `x`). */
function stack(f: Frame, top: number, opts: { align?: 'center' | 'left'; x?: number; width?: number; headline?: number; font?: 'serif' | 'serif-italic' | 'cormorant-italic'; kicker?: boolean; details?: boolean; kickerFont?: 'regular' | 'cinzel' } = {}): Layer[] {
  const align = opts.align ?? 'center';
  const x = opts.x ?? (align === 'center' ? f.w / 2 : 90);
  const width = opts.width ?? f.w - 180;
  const out: Layer[] = [];
  if (opts.kicker !== false) out.push(textLayer({ bind: 'kicker', x, y: top, size: opts.kickerFont === 'cinzel' ? 34 : 26, font: opts.kickerFont ?? 'regular', color: GOLD, align, width, upper: true, spacing: 0.32 }));
  out.push({ ...textLayer({ bind: 'headline', x, y: top + 50, size: opts.headline ?? 84, font: opts.font ?? 'serif-italic', color: BONE, align, width, fit: true, lineHeight: 1.05 }), ...(opts.kicker !== false ? { flow: { gap: 16 } } : {}) });
  if (opts.details !== false) out.push({ ...textLayer({ bind: 'details', x, y: top + 200, size: 30, font: 'light', color: LIGHT_GOLD, align, width, spacing: 0.04 }), flow: { gap: 22 } });
  return out;
}

/** Lay a template down on the doc, keeping what the owner added. */
export function applyAdTemplate(doc: StoryDoc, id: AdTemplateId, fields: Fields, a: Assets, opts: { photoMarked?: boolean } = {}): StoryDoc {
  const f = frameOf(doc);
  const zone = safeZone(f);
  /** The band a story's words and piece must sit in (the whole frame elsewhere). */
  const T = zone.top, B = f.h - zone.bottom;
  const keep = doc.layers.filter(l => !isTemplate(l));
  const wide = f.h < 700;
  type Bg = StoryDoc['bg'];
  const photoBg: Bg = { ...doc.bg, photoId: PHOTO, gradient: 'none', dim: 0, color: GROUND, color2: null };
  const groundBg: Bg = { ...doc.bg, photoId: null, gradient: 'none', dim: 0, color: GROUND, color2: '#132020' };
  let bg: Bg = photoBg;
  const out: Layer[] = [];

  if (id === 'clean') {
    const w = 64, h = markHeight('t', a, w);
    const y = zone.top ? zone.top + 36 : f.h - 70 - h;
    out.push(mark('t', a, f, f.w - 70 - w, y, w, BONE, 0.72));
  }

  if (id === 'headline' || id === 'certified') {
    bg = { ...photoBg, gradient: 'bottom', dim: 0.1 };
    const bottom = f.h - (zone.bottom || 0) - (wide ? 36 : 80);
    const top = bottom - (wide ? 190 : 300);
    out.push(...stack(f, top, { headline: wide ? 64 : 84, kicker: id === 'headline' }));
    if (id === 'certified') {
      out.push(mine(textLayer({ text: 'HRD Antwerp certified', x: 90, y: (zone.top || 0) + 70, size: 28, font: 'regular', color: BONE, align: 'left', upper: true, spacing: 0.26, box: { color: '#0A1111D9', radius: 40, pad: 22 } })));
    }
    const w = 200;
    out.push(mark('wordmark', a, f, f.w / 2 - w / 2, zone.top ? zone.top + 40 : 60, w, BONE));
  }

  if (id === 'framed') {
    bg = groundBg;
    out.push(...corners(f, 36));
    if (wide) {
      out.push(photoLayer(60, 60, 470, f.h - 120, { border: GOLD }));
      out.push(...stack(f, 150, { align: 'left', x: 590, width: 430, headline: 64 }));
      out.push(mark('wordmark', a, f, 590, 72, 150, BONE));
    } else if (zone.top) {
      // A story: the mark, the photo and the words all inside Instagram's clear band.
      const w = 170;
      out.push(mark('wordmark', a, f, f.w / 2 - w / 2, T + 24, w, BONE));
      const top = T + 110;
      const ph = B - top - 250;
      const pw = Math.min(900, Math.round(ph * 1.05));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top, pw, ph, { border: GOLD }));
      out.push(...stack(f, top + ph + 36, { headline: 70 }));
    } else {
      const top = 150;
      const ph = Math.max(360, f.h - top - 300);
      const pw = Math.min(900, Math.round(ph * 1.1));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top, pw, ph, { border: GOLD }));
      const w = 180;
      out.push(mark('wordmark', a, f, f.w / 2 - w / 2, 62, w, BONE));
      out.push(...stack(f, top + ph + 56, { headline: 72 }));
    }
  }

  if (id === 'heritage') {
    bg = groundBg;
    out.push(...corners(f, 36, 48, GOLD));
    if (wide) {
      out.push(photoLayer(70, 50, 380, f.h - 100, { mask: 'arch' }));
      out.push(...stack(f, 140, { align: 'left', x: 520, width: 480, headline: 60, font: 'cormorant-italic', kickerFont: 'cinzel' }));
    } else {
      // "Since 1989", the arch, the words, the wordmark — in a story all inside the clear band.
      const top = zone.top ? T + 16 : 130;
      const bottom = zone.top ? B - 20 : f.h - 70;
      const w = 160, mh = markHeight('wordmark', a, w);
      const ph = Math.min(900, bottom - (top + 70) - 40 - 190 - mh);
      const pw = Math.round(ph * 0.78);
      out.push(mine(textLayer({ text: 'Since 1989', x: f.w / 2, y: top, size: 40, font: 'cinzel', color: GOLD, align: 'center', upper: true, spacing: 0.3 })));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top + 70, pw, ph, { mask: 'arch' }));
      out.push(...stack(f, top + 70 + ph + 36, { headline: 70, font: 'cormorant-italic', kicker: false }));
      out.push(mark('wordmark', a, f, f.w / 2 - w / 2, bottom - mh, w, BONE));
    }
  }

  if (id === 'band') {
    const bandH = wide ? f.h : Math.round(f.h * (zone.top ? 0.2 : 0.3));
    const bandBottom = f.h - (zone.bottom || 0);
    if (wide) {
      out.push(rect(f.w * 0.52, 0, f.w * 0.48, f.h, GROUND, 0.94));
      out.push(...stack(f, 140, { align: 'left', x: f.w * 0.52 + 50, width: f.w * 0.48 - 100, headline: 60 }));
    } else {
      out.push(rect(0, bandBottom - bandH, f.w, bandH, GROUND, 0.92));
      out.push(line(90, bandBottom - bandH, f.w - 180, 0, GOLD, 2));
      out.push(...stack(f, bandBottom - bandH + 48, { align: 'left', x: 90, width: f.w - 320, headline: 70 }));
      const w = 150;
      out.push(mark('wordmark', a, f, f.w - 90 - w, bandBottom - bandH + 56, w, BONE));
    }
  }

  // A photograph that already carries the house's mark (taheri.shop burns it in) gets no second one.
  const placed = opts.photoMarked ? out.filter(l => l.kind !== 'wordmark') : out;
  return reflow({ ...doc, bg, layers: [...placed, ...keep] }, fields, a);
}

/** A blank ad in a format, the photo as its ground. */
export function blankAd(format: AdFormat): StoryDoc {
  return {
    bg: { photoId: PHOTO, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: GROUND },
    layers: [],
    frame: AD_FORMATS[format].frame,
    placements: {},
  };
}
