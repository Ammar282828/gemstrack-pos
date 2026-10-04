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
 * headline (the piece's line), kicker (a small line above it), weight (the piece's specs
 * from the ERP — karat, stones, weight; prices and specs are allowed in ads since
 * 2026-09-29) and details (the call to action). Laying a template down replaces the last
 * template's layers and keeps anything the owner added.
 */

import { reflow, textLayer, newCornerMark, newLayerId, frameOf, type Assets, type Fields, type ImageLayer, type Layer, type ShapeLayer, type StoryDoc } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import type { Placement } from './assessment';
import { BRAND, IDENTITY, VISUAL } from './brand';

/**
 * Meta's four placements, every other ratio the image model draws (2026-10-01, owner: "ads should
 * have an option to generate in any orientation ratio"), and any custom W:H — for a custom frame the
 * model draws at the nearest ratio it has and the frame trims it (`ai`).
 */
export type AdFormat = 'square' | 'portrait' | 'story' | 'landscape' | 'r2x3' | 'r3x4' | 'r5x4' | 'r4x3' | 'r3x2' | 'r16x9' | 'r21x9' | 'custom';
export interface AdFormatInfo { label: string; short: string; frame: Frame; px: number; placement: Placement; where: string; ai: string; meta: boolean }
const fixed = (label: string, short: string, h: number, px: number, placement: Placement, where: string, ai: string, meta = false): AdFormatInfo =>
  ({ label, short, frame: { w: 1080, h }, px, placement, where, ai, meta });
export const AD_FORMATS: Record<Exclude<AdFormat, 'custom'>, AdFormatInfo> = {
  portrait: fixed('Feed 4:5', '4:5', 1350, 1080, 'portrait', 'Instagram and Facebook feeds — the largest a feed ad can be', '4:5', true),
  square: fixed('Feed 1:1', '1:1', 1080, 1080, 'square', 'Feeds, the right column, Marketplace', '1:1', true),
  story: fixed('Stories & reels 9:16', '9:16', 1920, 1080, 'story', 'Stories and reels, full screen', '9:16', true),
  landscape: fixed('Link 1.91:1', '1.91:1', 565, 1200, 'square', 'Facebook link ads and search', '16:9', true),
  r2x3: fixed('Tall 2:3', '2:3', 1620, 1080, 'portrait', 'Pinterest, print, a tall post', '2:3'),
  r3x4: fixed('Portrait 3:4', '3:4', 1440, 1080, 'portrait', 'Instagram’s 3:4 grid, print', '3:4'),
  r5x4: fixed('Landscape 5:4', '5:4', 864, 1350, 'square', 'A near-square landscape', '5:4'),
  r4x3: fixed('Landscape 4:3', '4:3', 810, 1440, 'square', 'Slides, screens, print', '4:3'),
  r3x2: fixed('Landscape 3:2', '3:2', 720, 1620, 'square', 'A wide post, print', '3:2'),
  r16x9: fixed('Wide 16:9', '16:9', 608, 1920, 'square', 'Screens, YouTube, the website', '16:9'),
  r21x9: fixed('Banner 21:9', '21:9', 463, 2520, 'square', 'A website banner', '21:9'),
};
/** Meta's own placements: the ones a new ad, "all sizes" and the 9:16 pair work with. */
export const AD_FORMAT_ORDER = ['portrait', 'square', 'story', 'landscape'] as const satisfies readonly AdFormat[];
/** Every other shape, offered under "Any shape". */
export const MORE_FORMAT_ORDER = ['r2x3', 'r3x4', 'r5x4', 'r4x3', 'r3x2', 'r16x9', 'r21x9'] as const satisfies readonly AdFormat[];

/** The ratios the image model draws at (Gemini 3 Pro Image). */
export const AI_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export const nearestAiRatio = (w: number, h: number): string => {
  let best: string = '1:1', diff = Infinity;
  for (const r of AI_RATIOS) { const [a, b] = r.split(':').map(Number); const d = Math.abs(Math.log((a / b) / (w / h))); if (d < diff) { diff = d; best = r; } }
  return best;
};

/** A custom W:H as a frame 1080 wide, between 3:1 and 1:2.2, exported with its short side at least 1080 px. */
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** W:H in its smallest whole numbers (1080:1350 → 4:5). */
export const reduceRatio = (w: number, h: number): { w: number; h: number } => {
  const a = Math.max(1, Math.round(w) || 1), b = Math.max(1, Math.round(h) || 1), g = gcd(a, b);
  return { w: a / g, h: b / g };
};
export function customFormat(w: number, h: number): AdFormatInfo {
  const { w: rw, h: rh } = reduceRatio(Math.min(10_000, w), Math.min(10_000, h));
  const fh = Math.max(360, Math.min(2400, Math.round(1080 * rh / rw)));
  const px = fh < 1080 ? Math.min(3240, Math.round(1080 * 1080 / fh)) : 1080;
  const tall = fh > 1080;
  return {
    label: `Custom ${rw}:${rh}`, short: `${rw}:${rh}`, frame: { w: 1080, h: fh }, px,
    placement: fh >= 1800 ? 'story' : tall ? 'portrait' : 'square',
    where: `Your own shape — the AI draws at ${nearestAiRatio(1080, fh)} and the frame trims it`,
    ai: nearestAiRatio(1080, fh), meta: false,
  };
}
/** The smallest W:H (each at most 100) that gives a saved custom frame back exactly (1080×463 → 7:3). */
export function ratioOfFrame(f: Frame): { w: number; h: number } {
  for (let w = 1; w <= 100; w++) {
    const h = Math.round(w * f.h / f.w);
    if (h >= 1 && h <= 100 && customFormat(w, h).frame.h === f.h) return reduceRatio(w, h);
  }
  return reduceRatio(f.w, f.h);
}
/** How Meta shows a picture of this shape in feeds: as it is between 1.91:1 and 4:5, else cropped to the nearer end. */
export function metaFeedFit(f: Frame): 'as-is' | '4:5' | '1.91:1' {
  const r = f.w / f.h;
  return r < 0.8 - 1e-3 ? '4:5' : r > 1.91 + 1e-3 ? '1.91:1' : 'as-is';
}
/** Any format's facts; a custom one needs its W:H. */
export const formatInfo = (f: AdFormat, custom?: { w: number; h: number }): AdFormatInfo =>
  f === 'custom' ? customFormat(custom?.w ?? 1, custom?.h ?? 1) : AD_FORMATS[f];
export const isAdFormat = (v: unknown): v is AdFormat => typeof v === 'string' && (v === 'custom' || Object.prototype.hasOwnProperty.call(AD_FORMATS, v));

export const formatOfFrame = (f: Frame): AdFormat =>
  f.h >= 1800 ? 'story' : f.h >= 1300 ? 'portrait' : f.h <= 700 ? 'landscape' : 'square';

/** Where Instagram draws over a story or reel: keep what must be read out of these bands. */
export function safeZone(f: Frame): { top: number; bottom: number } {
  return f.h >= 1800 ? { top: Math.round(f.h * 0.14), bottom: Math.round(f.h * 0.35) } : { top: 0, bottom: 0 };
}

export type AdTemplateId = 'clean' | 'headline' | 'framed' | 'heritage' | 'band' | 'certified' | 'rate' | 'investment';
const ALL_TEMPLATES: { id: AdTemplateId; label: string; note: string; houses?: 'taheri'[] }[] = [
  { id: 'clean', label: 'The photo, quietly marked', note: 'The piece alone; the mark low in a corner.' },
  { id: 'headline', label: 'Headline on the photo', note: 'A line in the Didone over a soft shade, the specs and the call to action beneath.' },
  { id: 'framed', label: 'Framed on the house ground', note: 'The photo inset on the dark ground in a fine frame.' },
  { id: 'heritage', label: IDENTITY.since, note: 'The piece in an arch, the house’s line above, the wordmark below.' },
  { id: 'band', label: 'Conversation band', note: 'A dark band with the line and a call to message.' },
  { id: 'certified', label: IDENTITY.badge, note: `A “${IDENTITY.badge}” badge over the photo, the words beneath.` },
  { id: 'rate', label: 'Today’s gold rate', note: 'The day’s rate per tola from the ERP, the piece in an arch — for the WhatsApp channel.', houses: ['taheri'] },
  { id: 'investment', label: 'No making · No wastage', note: 'Investment gold: the standing offer over the framed photo, the specs beneath.', houses: ['taheri'] },
];
/** This house's layouts (the gold-rate and investment ones are Taheri's). */
export const AD_TEMPLATES = ALL_TEMPLATES.filter(t => !t.houses || (t.houses as string[]).includes(BRAND.identity.name));

/** Today's rates for the rate layout, per tola, from the ERP (`/api/ads/studio/rates`). */
export interface RateBoard { date: string; rows: { label: string; perTola: number }[] }
const TOLA_G = 11.6638;
/** Per-gram rates to the board's rows, per tola and rounded to the hundred ("~Rs 530,300"), as the vault says a rate is shown. */
export function rateBoard(perGram: { k24?: number; k22?: number; k21?: number; k18?: number }, date: string): RateBoard {
  const rows = ([['24K', perGram.k24], ['22K', perGram.k22], ['21K', perGram.k21], ['18K', perGram.k18]] as const)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([label, v]) => ({ label, perTola: Math.round((v! * TOLA_G) / 100) * 100 }));
  return { date, rows };
}
const rupees = (n: number) => `~Rs ${n.toLocaleString('en-US')}`;

export const PHOTO = 'photo';
const TPL = 'template';
const { gold: GOLD, lightGold: LIGHT_GOLD, bone: BONE, ground: GROUND, ground2: GROUND2 } = VISUAL;

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
  out.push({ ...textLayer({ bind: 'headline', x, y: top + 50, size: opts.headline ?? 84, font: opts.font ?? 'serif-italic', color: BONE, align, width, fit: true, lineHeight: 1.05 }), flow: { gap: 16 } });
  // The piece's specs from the ERP ("21K Yellow Gold · Ruby · 45.35g"); an empty line takes no room.
  out.push({ ...textLayer({ bind: 'weight', x, y: top + 150, size: 30, font: 'regular', color: BONE, align, width, spacing: 0.06 }), flow: { gap: 14 } });
  if (opts.details !== false) out.push({ ...textLayer({ bind: 'details', x, y: top + 200, size: 30, font: 'light', color: LIGHT_GOLD, align, width, spacing: 0.04 }), flow: { gap: 22 } });
  return out;
}

/** Lay a template down on the doc, keeping what the owner added. */
export function applyAdTemplate(doc: StoryDoc, id: AdTemplateId, fields: Fields, a: Assets, opts: { photoMarked?: boolean; rates?: RateBoard | null } = {}): StoryDoc {
  const f = frameOf(doc);
  const zone = safeZone(f);
  /** The band a story's words and piece must sit in (the whole frame elsewhere). */
  const T = zone.top, B = f.h - zone.bottom;
  const keep = doc.layers.filter(l => !isTemplate(l));
  // Wide by its ratio (3:2 and wider lay out side by side), so every shape lays out, not only 1.91:1.
  const wide = f.w / f.h > 1.4;
  type Bg = StoryDoc['bg'];
  const photoBg: Bg = { ...doc.bg, photoId: PHOTO, gradient: 'none', dim: 0, color: GROUND, color2: null };
  const groundBg: Bg = { ...doc.bg, photoId: null, gradient: 'none', dim: 0, color: GROUND, color2: GROUND2 };
  let bg: Bg = photoBg;
  const out: Layer[] = [];

  if (id === 'clean') {
    const w = 64, h = markHeight('t', a, w);
    const y = zone.top ? zone.top + 36 : f.h - 70 - h;
    out.push(mark('t', a, f, f.w - 70 - w, y, w, BONE, 0.72));
  }

  if ((id === 'headline' || id === 'certified') && wide) {
    // Side by side: across a wide frame the piece sits in the middle, so words laid over the photo cover it.
    // The photo as a panel on the left, the words and the mark on the house ground at the right.
    bg = groundBg;
    const pw = Math.round(f.w * 0.56), x = pw + 48, w = 140, mh = markHeight('wordmark', a, w);
    out.push(photoLayer(0, 0, pw, f.h));
    out.push(...stack(f, Math.max(40, Math.round(f.h / 2 - 130)), { align: 'left', x, width: f.w - x - 48, headline: 60, kicker: id === 'headline' }));
    if (id === 'certified') out.push(mine(textLayer({ text: IDENTITY.badge, x, y: 36, size: 22, font: 'regular', color: GOLD, align: 'left', upper: true, spacing: 0.26 })));
    out.push(mark('wordmark', a, f, f.w - 48 - w, f.h - 36 - mh, w, BONE));
  } else if (id === 'headline' || id === 'certified') {
    bg = { ...photoBg, gradient: 'bottom', dim: 0.1 };
    // A short frame (4:3, 5:4) keeps its words in the lower third, off the piece.
    const short = f.h < 1000;
    const bottom = f.h - (zone.bottom || 0) - 80;
    const top = bottom - (short ? 250 : 330);
    out.push(...stack(f, top, { headline: short ? 72 : 84, kicker: id === 'headline' }));
    if (id === 'certified') {
      out.push(mine(textLayer({ text: IDENTITY.badge, x: 90, y: (zone.top || 0) + 70, size: 28, font: 'regular', color: BONE, align: 'left', upper: true, spacing: 0.26, box: { color: '#0A1111D9', radius: 40, pad: 22 } })));
      // The badge reaches past the middle, so the mark goes top right instead of over it.
      const w = 160;
      out.push(mark('wordmark', a, f, f.w - 80 - w, (zone.top || 0) + 74, w, BONE));
    } else {
      const w = 200;
      out.push(mark('wordmark', a, f, f.w / 2 - w / 2, zone.top ? zone.top + 40 : 60, w, BONE));
    }
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
      const ph = B - top - 295;
      const pw = Math.min(900, Math.round(ph * 1.05));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top, pw, ph, { border: GOLD }));
      out.push(...stack(f, top + ph + 36, { headline: 70 }));
    } else {
      const top = 150;
      // A headline long enough to take two lines (about 0.42 em a character in the Didone italic) takes its
      // room from the photo, so the call to action stays inside the frame (2026-10-04: the first weekly
      // board's "Architectural Form Handcrafted in Gold" pushed "Message us…" off a 4:5).
      const twoLines = (fields.headline || '').length * 0.42 * 72 > f.w - 180;
      const ph = Math.max(360, f.h - top - 335 - (twoLines ? 80 : 0));
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
      const ph = Math.min(900, bottom - (top + 70) - 40 - 240 - mh);
      const pw = Math.round(ph * 0.78);
      out.push(mine(textLayer({ text: IDENTITY.since, x: f.w / 2, y: top, size: 40, font: 'cinzel', color: GOLD, align: 'center', upper: true, spacing: 0.3 })));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top + 70, pw, ph, { mask: 'arch' }));
      out.push(...stack(f, top + 70 + ph + 36, { headline: 70, font: 'cormorant-italic', kicker: false }));
      out.push(mark('wordmark', a, f, f.w / 2 - w / 2, bottom - mh, w, BONE));
    }
  }

  if (id === 'band') {
    const bandH = wide ? f.h : Math.round(f.h * (zone.top ? 0.2 : 0.3));
    const bandBottom = f.h - (zone.bottom || 0);
    if (wide) {
      bg = groundBg;
      out.push(photoLayer(0, 0, Math.round(f.w * 0.52), f.h));
      out.push(rect(f.w * 0.52, 0, f.w * 0.48, f.h, GROUND, 0.94));
      out.push(...stack(f, Math.max(40, Math.round(f.h / 2 - 150)), { align: 'left', x: f.w * 0.52 + 50, width: f.w * 0.48 - 100, headline: 60 }));
      const w = 130;
      out.push(mark('wordmark', a, f, f.w - 50 - w, f.h - 36 - markHeight('wordmark', a, w), w, BONE));
    } else {
      out.push(rect(0, bandBottom - bandH, f.w, bandH, GROUND, 0.92));
      out.push(line(90, bandBottom - bandH, f.w - 180, 0, GOLD, 2));
      out.push(...stack(f, bandBottom - bandH + 48, { align: 'left', x: 90, width: f.w - 320, headline: 70 }));
      const w = 150;
      out.push(mark('wordmark', a, f, f.w - 90 - w, bandBottom - bandH + 56, w, BONE));
    }
  }

  if (id === 'rate') {
    // Today's rate board: the day, the piece in an arch, a row per karat — or, without figures, the promise of them.
    bg = groundBg;
    out.push(...corners(f, 36, 48, GOLD));
    const top = (zone.top ? T + 24 : 80);
    const bottom = zone.top ? B - 16 : f.h - 60;
    const rows = opts.rates?.rows.slice(0, 3) ?? [];
    const x0 = wide ? 520 : 150, x1 = f.w - (wide ? 70 : 150);
    out.push(mine(textLayer({ text: 'Today’s gold rate', x: wide ? x0 : f.w / 2, y: top, size: 30, font: 'regular', color: GOLD, align: wide ? 'left' : 'center', upper: true, spacing: 0.32 })));
    if (opts.rates?.date) out.push(mine(textLayer({ text: opts.rates.date, x: wide ? x0 : f.w / 2, y: top + 46, size: 38, font: 'serif-italic', color: BONE, align: wide ? 'left' : 'center' })));
    const rowH = wide ? 62 : 78;
    const listH = rows.length ? rows.length * rowH : 110;
    const w = 150, mh = markHeight('wordmark', a, w);
    if (wide) {
      out.push(photoLayer(60, 50, 400, f.h - 100, { mask: 'arch' }));
    } else {
      const ph = Math.max(220, Math.min(!zone.top && f.h > 1500 ? 760 : 560, bottom - (top + 120) - listH - 150 - mh));
      const pw = Math.round(ph * 0.78);
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top + 110, pw, ph, { mask: 'arch' }));
    }
    let y = wide ? top + 110 : bottom - mh - 150 - listH;
    if (rows.length) {
      for (const r of rows) {
        out.push(mine(textLayer({ text: r.label, x: x0, y, size: wide ? 36 : 44, font: 'cinzel', color: GOLD, align: 'left' })));
        out.push(mine(textLayer({ text: `${rupees(r.perTola)} / tola`, x: x1, y, size: wide ? 36 : 44, font: 'serif', color: BONE, align: 'right' })));
        out.push(line(x0, y + rowH - 16, x1 - x0, 0, GOLD, 1));
        y += rowH;
      }
    } else {
      out.push(mine(textLayer({ text: 'The rate, every morning', x: wide ? x0 : f.w / 2, y, size: wide ? 52 : 64, font: 'serif-italic', color: BONE, align: wide ? 'left' : 'center', width: wide ? 480 : f.w - 180, fit: true })));
      y += listH;
    }
    out.push(textLayer({ bind: 'details', x: wide ? x0 : f.w / 2, y: y + 24, size: 30, font: 'light', color: LIGHT_GOLD, align: wide ? 'left' : 'center', width: wide ? x1 - x0 - w - 24 : f.w - 180, fit: wide, spacing: 0.04 }));
    out.push(mark('wordmark', a, f, wide ? f.w - 60 - w : f.w / 2 - w / 2, bottom - mh, w, BONE));
  }

  if (id === 'investment') {
    // The standing offer over a framed photo; the specs line beneath (karat and weight from the ERP).
    bg = groundBg;
    out.push(...corners(f, 36));
    if (wide) {
      out.push(photoLayer(60, 60, 470, f.h - 120, { border: GOLD }));
      out.push(mine(textLayer({ text: 'No making · No wastage', x: 590, y: 90, size: 30, font: 'cinzel', color: GOLD, align: 'left', upper: true, spacing: 0.12, width: f.w - 590 - 70, fit: true })));
      out.push(...stack(f, 150, { align: 'left', x: 590, width: 430, headline: 60, kicker: false }));
    } else {
      const top = zone.top ? T + 30 : 110;
      const ph = (zone.top ? B : f.h) - top - 100 - 300;
      const pw = Math.min(900, Math.round(ph * (zone.top ? 0.95 : 1.1)));
      out.push(mine(textLayer({ text: 'No making · No wastage', x: f.w / 2, y: top, size: 40, font: 'cinzel', color: GOLD, align: 'center', upper: true, spacing: 0.14 })));
      out.push(photoLayer(Math.round(f.w / 2 - pw / 2), top + 80, pw, ph, { border: GOLD }));
      out.push(...stack(f, top + 80 + ph + 40, { headline: 70, kicker: false }));
    }
  }

  // A photograph that already carries the house's mark (taheri.shop burns it in) gets no second one.
  const placed = opts.photoMarked ? out.filter(l => l.kind !== 'wordmark') : out;
  return reflow({ ...doc, bg, layers: [...placed, ...keep] }, fields, a);
}

/** A blank ad in a format, the photo as its ground. */
export function blankAd(format: AdFormat, frame?: Frame): StoryDoc {
  return {
    bg: { photoId: PHOTO, placement: { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, dim: 0, gradient: 'none', color: GROUND },
    layers: [],
    frame: frame ?? formatInfo(format).frame,
    placements: {},
  };
}

/** An ad the image model painted whole: the picture as it came, and the house's wordmark top right, where the model was told to leave room. */
export function paintedAd(format: AdFormat, a: Assets, frame?: Frame): StoryDoc {
  const d = blankAd(format, frame);
  const f = d.frame ?? formatInfo(format).frame;
  const w = 170, zone = safeZone(f);
  return { ...d, layers: [mark('wordmark', a, f, f.w - 60 - w, (zone.top || 0) + 56, w, BONE)] };
}
