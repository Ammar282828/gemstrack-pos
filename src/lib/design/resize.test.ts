import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AD_FORMATS, AD_TEMPLATES, customFormat } from '@/lib/ads/studio/templates';
import { frameOf, newQr, textOf, type Layer, type StoryDoc, type TextLayer } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import { CUSTOM_RATIOS, ELEVEN, FIELDS, assetsFor, customFrames, freeHand, installFakeDom, rateBoardFor, removeFakeDom, templateDoc } from './resize.fixture';
import { fitSubject, resize, resizeOne, swapPhoto, pageOf } from './resize';
import { makeMeasure, reflowDoc, scoreLayout, shownTexts } from './score';
import { safeBands } from './safe';

beforeAll(installFakeDom);
afterAll(removeFakeDom);

const assets = assetsFor();
const m = makeMeasure(FIELDS, assets);
const frames: { name: string; frame: Frame }[] = [
  ...ELEVEN.map(f => ({ name: f, frame: f === 'custom' ? { w: 1080, h: 1080 } : AD_FORMATS[f].frame })),
  ...CUSTOM_RATIOS.map(([w, h], i) => ({ name: `custom ${w}:${h}`, frame: customFrames()[i] })),
];

const textBoxes = (doc: StoryDoc) => shownTexts(reflowDoc(doc, FIELDS, m), FIELDS).map(l => ({ l, b: m.box(l) }));

describe('the eight templates in every format', () => {
  // Each template starts as the 4:5 ad (the usual master), the story or the square, and goes to every other shape.
  for (const from of ['portrait', 'story', 'square'] as const) for (const t of AD_TEMPLATES) {
    for (const target of frames) {
      it(`${from} ${t.id} → ${target.name} scores 80 or more, with its words inside the safe bands`, () => {
        const source = templateDoc(t.id, AD_FORMATS[from].frame);
        const [r] = resize(source, FIELDS, assets, [target.frame], { rates: rateBoardFor(t.id) });
        expect(r.penalties.map(p => p.why)).toEqual(r.score >= 80 ? expect.anything() : []);
        expect(r.score).toBeGreaterThanOrEqual(80);
        expect(frameOf(r.doc)).toEqual(target.frame);
        if (target.frame.h >= 1800) {
          const bands = safeBands(target.frame);
          for (const { b } of textBoxes(r.doc)) {
            expect(b.y).toBeGreaterThanOrEqual(bands.top - 0.5);
            expect(b.y + b.h).toBeLessThanOrEqual(target.frame.h - bands.bottom + 0.5);
            expect(b.x).toBeGreaterThanOrEqual(-0.5);
            expect(b.x + b.w).toBeLessThanOrEqual(target.frame.w + 0.5);
          }
        }
      });
    }
  }
});

describe('a free-hand design', () => {
  it('keeps its order, wraps and never overlaps going 4:5 → 9:16 → 1.91:1 → 1:1', () => {
    let doc = freeHand();
    for (const f of [AD_FORMATS.story.frame, AD_FORMATS.landscape.frame, AD_FORMATS.square.frame]) {
      const [r] = resize(doc, FIELDS, assets, [f]);
      expect(r.penalties.find(p => p.id === 'overlap')).toBeUndefined();
      expect(r.penalties.find(p => p.id === 'outside')).toBeUndefined();
      const lines = textBoxes(r.doc).filter(x => !x.l.box).sort((a, b) => a.b.y - b.b.y).map(x => textOf(x.l, FIELDS));
      // Reading order: the headline, the specs, the call to action.
      if (f.w / f.h <= 1.4) expect(lines).toEqual(['Handmade in Karachi', '21K gold · ruby · 12.4 g', 'Message us to order']);
      expect(r.score).toBeGreaterThanOrEqual(80);
      doc = r.doc;
    }
  });

  it('puts the photo beside the words in a wide shape', () => {
    const [r] = resize(freeHand(), FIELDS, assets, [AD_FORMATS.r16x9.frame]);
    const panel = r.doc.layers.find(l => l.kind === 'image' && l.role === 'photo');
    expect(panel).toBeDefined();
    expect(r.doc.bg.photoId).toBeNull();
    for (const { b } of textBoxes(r.doc)) expect(b.x).toBeGreaterThanOrEqual(AD_FORMATS.r16x9.frame.w * 0.5);
  });

  it('is idempotent: 4:5 → 9:16 → 4:5 lands within 2% of where it began', () => {
    // Its words sit where the story's bands leave room, so nothing is moved on the way.
    const src = freeHand();
    const moved = { ...src, layers: src.layers.map((l: Layer) => (l.kind === 'text' && l.text === 'Message us to order' ? { ...l, y: 760 } : l.kind === 'text' && l.text === 'NEW' ? { ...l, y: 470 } : l)) } as StoryDoc;
    const [a] = resize(moved, FIELDS, assets, [AD_FORMATS.story.frame]);
    const [b] = resize(a.doc, FIELDS, assets, [AD_FORMATS.portrait.frame]);
    const f = frameOf(moved);
    for (const l of moved.layers) {
      const was = m.box(l);
      const now = b.doc.layers.find(x => x.kind === l.kind && (x.kind !== 'text' || (l as TextLayer).text === x.text) && (x.kind !== 'image' || true));
      expect(now, l.id).toBeDefined();
      const bn = m.box(now as Layer);
      const tol = 0.02;
      expect(Math.abs(bn.x - was.x) / f.w, `${l.kind} x`).toBeLessThanOrEqual(tol);
      expect(Math.abs(bn.y - was.y) / f.h, `${l.kind} y`).toBeLessThanOrEqual(tol);
      expect(Math.abs(bn.w - was.w) / f.w, `${l.kind} w`).toBeLessThanOrEqual(tol);
      expect(Math.abs(bn.h - was.h) / f.h, `${l.kind} h`).toBeLessThanOrEqual(tol);
    }
  });

  it('works with no browser at all (the estimate measures the words)', () => {
    removeFakeDom();
    try {
      const [r] = resize(freeHand(), FIELDS, assets, [AD_FORMATS.story.frame, AD_FORMATS.r21x9.frame]);
      expect(r.doc.layers.length).toBeGreaterThan(0);
      expect(r.score).toBeGreaterThanOrEqual(80);
    } finally {
      installFakeDom();
    }
  });

  it('never changes the words', () => {
    const [r] = resize(freeHand(), FIELDS, assets, [AD_FORMATS.story.frame]);
    const before = freeHand().layers.filter((l): l is TextLayer => l.kind === 'text').map(l => l.text).sort();
    const after = r.doc.layers.filter((l): l is TextLayer => l.kind === 'text').map(l => l.text).sort();
    expect(after).toEqual(before);
  });
});

describe('a template the owner has edited', () => {
  it('keeps the hand edits instead of laying the template again', () => {
    const src = templateDoc('headline', AD_FORMATS.portrait.frame);
    const edited: StoryDoc = { ...src, layers: src.layers.map(l => (l.kind === 'text' && l.bind === 'headline' ? { ...l, x: 200, y: 200, align: 'left' as const } : l)) };
    const [r] = resize(edited, FIELDS, assets, [AD_FORMATS.square.frame]);
    expect(r.strategy).not.toBe('template');
  });

  it('carries the owner’s own layers across a template re-lay', () => {
    const src = templateDoc('headline', AD_FORMATS.portrait.frame);
    const own = freeHand().layers.find(l => l.kind === 'image')!;
    const [r] = resize({ ...src, layers: [...src.layers, own] }, FIELDS, assets, [AD_FORMATS.story.frame]);
    expect(r.doc.layers.some(l => l.id === own.id)).toBe(true);
  });
});

describe('fitSubject', () => {
  const mid = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
  it('crops a square photo to a story around the piece', () => {
    const r = fitSubject(1, mid, AD_FORMATS.story.frame);
    expect(r.needsExtend).toBe(false);
    expect(r.placement.mode).toBe('fill');
  });
  it('shows the whole photo and asks to extend when 21:9 cannot hold the piece', () => {
    const r = fitSubject(1, mid, AD_FORMATS.r21x9.frame);
    expect(r.needsExtend).toBe(true);
    expect(r.placement.mode).toBe('fit');
  });
  it('follows a piece off to one side', () => {
    const r = fitSubject(1, { x: 0.05, y: 0.3, w: 0.3, h: 0.4 }, AD_FORMATS.story.frame);
    expect(r.placement.focusX).toBeLessThan(0.3);
  });
  it('flags needsExtend on the result', () => {
    const r = resizeOne({ ...freeHand(), layers: [] }, FIELDS, assets, AD_FORMATS.r21x9.frame);
    expect(r.needsExtend).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Extend/);
  });
});

describe('pages', () => {
  it('make resized pages tied to their master, and swap a photo wherever it shows', () => {
    const [r] = resize(freeHand(), FIELDS, assets, [AD_FORMATS.story.frame]);
    const p = pageOf(r, { format: 'story', label: 'Story', master: 'master-1' });
    expect(p.page).toMatchObject({ origin: 'resized', syncedFrom: 'master-1', format: 'story', frame: AD_FORMATS.story.frame });
    const swapped = swapPhoto(p.doc, 'photo', 'photo-x');
    expect(swapped.bg.photoId).toBe('photo-x');
    expect(swapped.layers.filter(l => l.kind === 'image').every(l => l.kind === 'image' && l.photoId === 'photo-x')).toBe(true);
    expect(pageOf(r).page.format).toBe('custom');
  });
  it('a custom frame is a real frame', () => {
    expect(customFormat(7, 3).frame.w).toBe(1080);
  });
  it('scores a bare layout', () => {
    expect(scoreLayout(freeHand(), FIELDS, assets).score).toBeGreaterThan(0);
  });
});

describe('a QR code', () => {
  it('stays square, scannable and inside the safe bands going 4:5 → 9:16 → 1.91:1', () => {
    const start = freeHand();
    const qr = { ...newQr('https://taheri.shop/p/ruby', '#111111', frameOf(start)), x: 80, y: 1000, w: 200 };
    let doc: StoryDoc = { ...start, layers: [...start.layers, qr] };
    for (const f of [AD_FORMATS.story.frame, AD_FORMATS.landscape.frame]) {
      const [r] = resize(doc, FIELDS, assets, [f]);
      const q = r.doc.layers.find(l => l.id === qr.id);
      expect(q?.kind).toBe('qr');
      if (q?.kind !== 'qr') return;
      const b = m.box(q);
      expect(b.w).toBe(b.h);
      expect(q.w).toBeGreaterThanOrEqual(120);
      expect(q.value).toBe(qr.value);
      expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      const bands = safeBands(f);
      expect(b.x).toBeGreaterThanOrEqual(bands.left - 0.5);
      expect(b.y).toBeGreaterThanOrEqual(bands.top - 0.5);
      expect(b.x + b.w).toBeLessThanOrEqual(f.w - bands.right + 0.5);
      expect(b.y + b.h).toBeLessThanOrEqual(f.h - bands.bottom + 0.5);
      expect(r.penalties.find(p => p.id === 'qr')).toBeUndefined();
      doc = r.doc;
    }
  });

  it('is raised to the scannable minimum and the score notices one that is too small', () => {
    const start = freeHand();
    const tiny = { ...newQr('https://taheri.shop', '#111111', frameOf(start)), x: 80, y: 1000, w: 90 };
    const doc: StoryDoc = { ...start, layers: [...start.layers, tiny] };
    expect(scoreLayout(doc, FIELDS, assets).penalties.some(p => p.id === 'qr')).toBe(true);
    const [r] = resize(doc, FIELDS, assets, [AD_FORMATS.landscape.frame]);
    expect((r.doc.layers.find(l => l.id === tiny.id) as { w: number }).w).toBeGreaterThanOrEqual(120);
  });
});
