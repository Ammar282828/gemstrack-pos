import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AD_FORMATS } from '@/lib/ads/studio/templates';
import type { StoryDoc, TextLayer } from '@/lib/social/editor';
import { FIELDS, assetsFor, freeHand, installFakeDom, removeFakeDom, templateDoc } from './resize.fixture';
import { estimateText, makeMeasure, minTextSize, photoRectIn, reflowDoc, scoreLayout, subjectInFrame } from './score';

beforeAll(installFakeDom);
afterAll(removeFakeDom);

const assets = assetsFor();
const edit = (doc: StoryDoc, fn: (l: TextLayer) => TextLayer): StoryDoc => ({ ...doc, layers: doc.layers.map(l => (l.kind === 'text' ? fn(l) : l)) });

describe('scoreLayout', () => {
  it('scores a clean template at the top', () => {
    const s = scoreLayout(templateDoc('heritage', AD_FORMATS.portrait.frame), FIELDS, assets);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.penalties).toEqual([]);
  });

  it('takes 40 off for a word outside the frame', () => {
    const doc = freeHand();
    const out = edit(doc, l => (l.text === 'NEW' ? { ...l, x: 1200 } : l));
    const s = scoreLayout(out, FIELDS, assets);
    expect(s.penalties.map(p => p.id)).toContain('outside');
    expect(scoreLayout(doc, FIELDS, assets).score - s.score).toBeGreaterThanOrEqual(40);
  });

  it('takes 40 off for words in a story’s bands', () => {
    const doc = { ...freeHand({ w: 1080, h: 1920 }) };
    const s = scoreLayout(edit(doc, l => (l.text === 'NEW' ? { ...l, y: 40 } : l)), FIELDS, assets);
    expect(s.penalties.map(p => p.id)).toContain('outside');
  });

  it('takes 25 off for words on one another', () => {
    const doc = edit(freeHand(), l => (l.text === '21K gold · ruby · 12.4 g' ? { ...l, y: 340 } : l));
    expect(scoreLayout(doc, FIELDS, assets).penalties.find(p => p.id === 'overlap')?.points).toBe(25);
  });

  it('takes 20 off for words too small to read', () => {
    const doc = edit(freeHand(), l => (l.text === 'NEW' ? { ...l, size: 14 } : l));
    expect(scoreLayout(doc, FIELDS, assets).penalties.find(p => p.id === 'small')?.points).toBe(20);
    expect(minTextSize({ w: 1080, h: 1920 })).toBe(28);
    expect(minTextSize({ w: 1080, h: 463 })).toBeCloseTo(13.89, 1);
  });

  it('takes 15 off for a mark on a piece the page said was there', () => {
    const doc = freeHand();
    const on = { ...doc, layers: doc.layers.map(l => (l.kind === 'wordmark' ? { ...l, x: 400, y: 500 } : l)) } as StoryDoc;
    const s = scoreLayout(on, FIELDS, assets, { subject: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } });
    expect(s.penalties.map(p => p.id)).toContain('mark');
  });

  it('adds 5 for the call to action being last and 5 for the stack lined up', () => {
    const s = scoreLayout(templateDoc('headline', AD_FORMATS.portrait.frame), FIELDS, assets);
    expect(s.bonuses.map(b => b.id).sort()).toEqual(['aligned', 'cta']);
  });

  it('stays between 0 and 100', () => {
    const doc = edit(freeHand(), l => ({ ...l, x: 5000, y: 5000, size: 8 }));
    const s = scoreLayout(doc, FIELDS, assets);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
  });
});

describe('where the piece lands', () => {
  it('mirrors drawStoryPhoto: a fill crops, a fit shows it all', () => {
    expect(photoRectIn(1, { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 }, { w: 1080, h: 1920 })).toMatchObject({ x: -420, y: 0, w: 1920, h: 1920 });
    expect(photoRectIn(1, { mode: 'fit', zoom: 1, focusX: 0.5, focusY: 0.5 }, { w: 1080, h: 1920 })).toMatchObject({ x: 0, y: 420, w: 1080, h: 1080 });
  });
  it('says how much of the piece shows', () => {
    const doc = freeHand({ w: 1080, h: 1920 });
    const s = subjectInFrame(doc, assets, { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, 1)!;
    expect(s.visible).toBeGreaterThan(0.9);
    expect(s.visible).toBeLessThan(1);
  });
});

describe('measuring without a browser', () => {
  it('wraps, fits and stacks on estimated widths', () => {
    const doc = templateDoc('headline', AD_FORMATS.portrait.frame);
    removeFakeDom();
    try {
      const m = makeMeasure(FIELDS, assets);
      const head = doc.layers.find((l): l is TextLayer => l.kind === 'text' && l.bind === 'headline')!;
      const e = estimateText(head, FIELDS);
      expect(e.w).toBeGreaterThan(0);
      expect(e.w).toBeLessThanOrEqual(head.width + 1);
      const flowed = reflowDoc(doc, FIELDS, m);
      const ys = flowed.layers.filter((l): l is TextLayer => l.kind === 'text' && !!l.flow).map(l => l.y);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    } finally {
      installFakeDom();
    }
  });
});
