import { afterEach, describe, expect, it } from 'vitest';
import { applyPreset, emptyDoc, layerBox, textLayer, type Assets, type Fields, type FontFamilies, type StoryDoc, type TextLayer } from './editor';
import { avoidSubject, findSubject, subjectInStory, subjectOf, withFoundSubject } from './subject';
import { makeHarness, type Harness } from './render-harness';
import { PALETTES } from './palettes';
import { applyAdTemplate, blankAd } from '@/lib/ads/studio/templates';
import type { Box01 } from './editor';

// ── Synthetic photographs ──────────────────────────────────────────────────

type RGB = [number, number, number];
function paint(w: number, h: number, ground: (x: number, y: number) => RGB, things: { inside: (x: number, y: number) => boolean; colour: RGB }[] = [], noise = 0) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c = ground(x, y);
    for (const t of things) if (t.inside(x, y)) c = t.colour;
    const i = (y * w + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = Math.max(0, Math.min(255, c[k] + (noise ? (rnd() - 0.5) * noise : 0)));
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}
const white = (): RGB => [250, 250, 250];
const GOLD: RGB = [200, 150, 40];
const ring = (cx: number, cy: number, r: number, th: number) => ({ inside: (x: number, y: number) => { const d = Math.hypot(x - cx, y - cy); return d <= r && d >= r - th; }, colour: GOLD });
const disc = (cx: number, cy: number, r: number) => ({ inside: (x: number, y: number) => Math.hypot(x - cx, y - cy) <= r, colour: GOLD });
const near = (b: Box01 | null, want: Box01, tol = 0.1) => {
  expect(b).not.toBeNull();
  expect(b!.x).toBeLessThanOrEqual(want.x + tol); expect(b!.y).toBeLessThanOrEqual(want.y + tol);
  expect(b!.x + b!.w).toBeGreaterThanOrEqual(want.x + want.w - tol); expect(b!.y + b!.h).toBeGreaterThanOrEqual(want.y + want.h - tol);
  expect(b!.w).toBeLessThanOrEqual(want.w + 3 * tol); expect(b!.h).toBeLessThanOrEqual(want.h + 3 * tol);
};

describe('findSubject', () => {
  it('finds a ring on white, hole and all', () => {
    const b = findSubject(paint(120, 160, white, [ring(60, 80, 30, 7)], 6));
    near(b, { x: 30 / 120, y: 50 / 160, w: 60 / 120, h: 60 / 160 });
  });
  it('follows a gradient ground', () => {
    const b = findSubject(paint(120, 160, (x, y) => [60 + y, 70 + y * 0.8, 90 + y * 0.5] as RGB, [disc(60, 60, 24)], 4));
    near(b, { x: 36 / 120, y: 36 / 160, w: 48 / 120, h: 48 / 160 });
  });
  it('finds an off-centre subject where it is', () => {
    const b = findSubject(paint(120, 160, white, [disc(30, 125, 18)], 4));
    near(b, { x: 12 / 120, y: 107 / 160, w: 36 / 120, h: 36 / 160 });
    expect(b!.x + b!.w / 2).toBeLessThan(0.4);
    expect(b!.y + b!.h / 2).toBeGreaterThan(0.65);
  });
  it('joins two pieces close together and keeps the one in the middle of two far apart', () => {
    const pair = findSubject(paint(160, 120, white, [disc(55, 60, 14), disc(95, 60, 14)], 4))!;
    expect(pair.x).toBeLessThan(0.3); expect(pair.x + pair.w).toBeGreaterThan(0.7);
    const apart = findSubject(paint(240, 120, white, [disc(110, 60, 22), disc(222, 100, 8)], 4))!;
    expect(apart.x + apart.w).toBeLessThan(0.7);
  });
  it('says nothing for a busy picture, a blank one, or a subject that is the whole picture', () => {
    const noise = paint(120, 160, () => [128, 128, 128], [], 255);
    expect(findSubject(noise)).toBeNull();
    expect(findSubject(paint(120, 160, white, [], 4))).toBeNull();
    expect(findSubject(paint(120, 160, white, [{ inside: (x, y) => x > 2 && y > 2 && x < 118 && y < 158, colour: GOLD }], 4))).toBeNull();
  });
  it('works on a large photo by shrinking it', () => {
    const b = findSubject(paint(900, 1200, white, [disc(450, 600, 200)], 6));
    near(b, { x: 250 / 900, y: 400 / 1200, w: 400 / 900, h: 400 / 1200 });
  });
});

// ── Keeping the words off it ───────────────────────────────────────────────

const fonts: FontFamilies = { headline: 'H', body: 'B', serif: 'S' };
const fields: Fields = { kicker: '', headline: 'Emerald halo', weight: '21K · 4.2g', details: 'Message us' };
let h: Harness | undefined;
afterEach(() => h?.restore());
const setup = (iw = 1080, ih = 1920) => {
  h = makeHarness();
  const assets: Assets = { photos: { p1: h.image('p1', iw, ih) }, marks: { wordmark: h.image('wordmark', 400, 100) }, fonts };
  return { assets };
};
const story = (): StoryDoc => emptyDoc('p1');
const laid = (assets: Assets, subject?: Box01, doc: StoryDoc = story()) =>
  applyPreset(subject ? { ...doc, meta: { subject } } : doc, 'stack-left', PALETTES[0], fields, assets, { weightOwnLine: true, wordmark: true });
const hits = (doc: StoryDoc, assets: Assets, subject: Box01) => {
  const s = subjectInStory(doc, subject, assets)!;
  return doc.layers.filter(l => (l.kind === 'text' && !!l.bind) || l.kind === 'wordmark').filter(l => {
    const b = layerBox(l, fields, assets);
    return Math.min(b.x + b.w, s.x + s.w) - Math.max(b.x, s.x) > 3 && Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y) > 3;
  });
};
const shape = (d: StoryDoc) => d.layers.map(l => ({ ...l, id: l.id.split('-')[0] }));
const bound = (doc: StoryDoc) => doc.layers.filter((l): l is TextLayer => l.kind === 'text' && !!l.bind);

describe('avoidSubject', () => {
  it('moves the words below a subject at the top, keeping order and spacing', () => {
    const { assets } = setup();
    const subject = { x: 0.1, y: 0.1, w: 0.8, h: 0.25 };
    const before = applyPreset(story(), 'stack-left', PALETTES[0], fields, assets, { weightOwnLine: true, wordmark: true });
    expect(hits(before, assets, subject).length).toBeGreaterThan(0);
    const after = laid(assets, subject);
    expect(hits(after, assets, subject)).toEqual([]);
    const a = bound(before), b = bound(after);
    expect(b.map(l => l.bind)).toEqual(a.map(l => l.bind));
    expect(b[0].y).toBeGreaterThan(0.1 * 1920 + 0.25 * 1920);
    const gaps = (ls: typeof a) => ls.slice(1).map((l, i) => l.y - ls[i].y);
    expect(gaps(b)).toEqual(gaps(a));
    expect(b.every(l => l.x === 96)).toBe(true);
  });
  it('moves the words above a subject at the bottom, inside the story safe area', () => {
    const { assets } = setup();
    const subject = { x: 0.15, y: 0.55, w: 0.7, h: 0.35 };
    const after = laid(assets, subject);
    expect(hits(after, assets, subject)).toEqual([]);
    const boxes = bound(after).map(l => layerBox(l, fields, assets));
    expect(Math.min(...boxes.map(b => b.y))).toBeGreaterThanOrEqual(0.14 * 1920 - 1);
    expect(Math.max(...boxes.map(b => b.y + b.h))).toBeLessThanOrEqual(0.55 * 1920);
  });
  it('leaves a document alone when nothing is on the subject, or there is no subject', () => {
    const { assets } = setup();
    const subject = { x: 0.2, y: 0.62, w: 0.6, h: 0.3 };
    const plain = applyPreset(story(), 'stack-left', PALETTES[0], fields, assets, { weightOwnLine: true, wordmark: true });
    const same = laid(assets, subject);
    expect(shape(same)).toEqual(shape(plain));
    expect(avoidSubject(plain, subject, fields, assets)).toBe(plain);
    expect(shape(laid(assets))).toEqual(shape(plain));
  });
  it('does not move layers that are not the layout\'s own', () => {
    const { assets } = setup();
    const mine = textLayer({ text: 'Mine', x: 100, y: 400, size: 60, font: 'regular', color: '#fff', width: 400 });
    const subject = { x: 0.05, y: 0.1, w: 0.9, h: 0.3 };
    const out = laid(assets, subject, { ...story(), layers: [mine] });
    expect(out.layers.find(l => l.id === mine.id)).toEqual(mine);
  });
  it('pans a tall photo when no band is tall enough', () => {
    const { assets } = setup(1080, 3600); // a long photo: the crop can slide up and down
    const subject = { x: 0.2, y: 0.34, w: 0.6, h: 0.22 };
    const before = applyPreset(story(), 'stack-left', PALETTES[0], fields, assets, { weightOwnLine: true, wordmark: true });
    expect(hits(before, assets, subject).length).toBeGreaterThan(0);
    const after = laid(assets, subject);
    expect(hits(after, assets, subject)).toEqual([]);
    expect(after.bg.placement.focusY).not.toBe(0.5);
    // The piece is still whole in the frame.
    const s = subjectInStory(after, subject, assets)!;
    expect(s.y).toBeGreaterThanOrEqual(0); expect(s.y + s.h).toBeLessThanOrEqual(1920);
  });
  it('shrinks the words, not under 80%, when only that helps', () => {
    const { assets } = setup();
    // Free bands of ~ 600 above and below a 300-tall middle subject, a block just over that.
    const big: Fields = { ...fields, headline: 'Emerald halo' };
    const subject = { x: 0.2, y: 0.415, w: 0.6, h: 0.14 };
    const doc = applyPreset(story(), 'stack-left', PALETTES[0], big, assets, { weightOwnLine: true, wordmark: true });
    const out = avoidSubject({ ...doc, meta: { subject } }, subject, big, assets, { ids: new Set(bound(doc).map(l => l.id)) });
    const sizes = (d: StoryDoc) => bound(d).map(l => l.size);
    const k = sizes(out)[1] / sizes(doc)[1]; // the headline
    expect(k).toBeGreaterThanOrEqual(0.8 - 1e-9);
    expect(k).toBeLessThan(1);
    expect(hits(out, assets, subject)).toEqual([]);
  });
  it('keeps the wordmark off the subject too', () => {
    const { assets } = setup();
    const subject = { x: 0.5, y: 0.04, w: 0.45, h: 0.12 };
    const out = laid(assets, subject);
    expect(hits(out, assets, subject)).toEqual([]);
  });
});

describe('withFoundSubject', () => {
  it('keeps what it found on the document, and an explicit subject wins', () => {
    const { assets } = setup();
    const doc = story();
    expect(withFoundSubject(doc, assets)).toBe(doc); // no canvas pixels worth a subject here
    const given = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(subjectOf({ ...doc, meta: { subject: given } }, assets)).toEqual(given);
    const found = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
    expect(subjectOf({ ...doc, meta: { found: { photoId: 'p1', box: found } } }, assets)).toEqual(found);
    expect(subjectOf({ ...doc, meta: { found: { photoId: 'other', box: found } } }, assets)).toBeNull();
  });
});

describe('ad templates in story shape', () => {
  it('keeps the headline template\'s words off a piece in the lower middle of the photo, with the shade at the top', () => {
    const { assets } = setup();
    assets.photos.photo = assets.photos.p1;
    const subject = { x: 0.15, y: 0.42, w: 0.7, h: 0.3 };
    const base = { ...blankAd('story'), meta: { subject } };
    const doc = applyAdTemplate(base, 'headline', fields, assets);
    const s = subjectInStory(doc, subject, assets)!;
    for (const l of doc.layers.filter(l => l.kind === 'text' && !!l.bind)) {
      const b = layerBox(l, fields, assets);
      expect(b.y + b.h <= s.y || b.y >= s.y + s.h).toBe(true);
    }
    expect(doc.bg.gradient).toBe('top');
    expect(applyAdTemplate(blankAd('story'), 'headline', fields, assets).bg.gradient).toBe('bottom');
  });
});
