import { describe, expect, it } from 'vitest';
import { STORY_DRAFT_SEEDS, buildDrafts, storyCaption, storyDay, storyName, storyWeight } from './story-drafts';
import { cleanCorners, planCorners, type Pixels } from './week-story';

describe('story drafts', () => {
  it('Taheri has 57, each piece once, each saying what it is', () => {
    const seeds = STORY_DRAFT_SEEDS.taheri;
    expect(seeds).toHaveLength(57);
    expect(new Set(seeds.map(s => s.id)).size).toBe(57);
    for (const s of seeds) {
      expect(s.id).toMatch(/\.webp$/);
      expect(s.kind.trim()).not.toBe('');
    }
    expect(STORY_DRAFT_SEEDS.mina).toEqual([]);
  });

  it('names one piece of a numbered run, and keeps a number that is its name', () => {
    expect(storyName('Panjtan Ruby Enamel Taweez II')).toBe('Panjtan Ruby Enamel Taweez');
    expect(storyName('Two-Tone Diamond Floral Set IV')).toBe('Two-Tone Diamond Floral Set');
    expect(storyName('Ruby Bangle and Ring 22')).toBe('Ruby Bangle and Ring');
    expect(storyName('Natural Ruby Ring No. 85')).toBe('Natural Ruby Ring No. 85');
    expect(storyName('Ya Ali Navratan Shield Taweez')).toBe('Ya Ali Navratan Shield Taweez');
  });

  it('prints grams as weighed, without trailing zeros', () => {
    expect(storyWeight(62.9)).toBe('62.9');
    expect(storyWeight(30)).toBe('30');
    expect(storyWeight(16.666)).toBe('16.67');
    expect(storyWeight(null)).toBe('');
    expect(storyWeight(0)).toBe('');
  });

  it('places each draft on a day, a week at a time from a Monday', () => {
    expect(storyDay(1)).toBe('Week 1 · Mon');
    expect(storyDay(7)).toBe('Week 1 · Sun');
    expect(storyDay(8)).toBe('Week 2 · Mon');
    expect(storyDay(57)).toBe('Week 9 · Mon');
  });

  it('takes the name and weight the site has now, and says when a piece is gone', () => {
    const seeds = [{ id: 'a.webp', kind: 'Ring' }, { id: 'b.webp', kind: 'Set' }, { id: 'c.webp', kind: 'Chain' }];
    const pieces = new Map([
      ['a.webp', { name: 'Oval Ruby Ring II', weightGrams: 4.5 }],
      ['b.webp', { name: 'Gold Set', weightGrams: null, hidden: true }],
    ]);
    const d = buildDrafts(seeds, pieces, { 'a.webp': { status: 'posted', at: '2026-10-27T10:00:00Z', by: 'x' } });
    expect(d.map(x => [x.n, x.name, x.weight, x.missing, x.state?.status ?? null])).toEqual([
      [1, 'Oval Ruby Ring', '4.5', false, 'posted'],
      [2, 'Gold Set', '', true, null],
      [3, 'c', '', true, null],
    ]);
  });

  it('links a piece that is on the site, and not one that is hidden or gone', () => {
    const pieces = new Map([
      ['a.webp', { name: 'A', weightGrams: 1, url: 'https://taheri.shop/rings/a' }],
      ['b.webp', { name: 'B', weightGrams: 1, url: 'https://taheri.shop/rings/b', hidden: true }],
    ]);
    const d = buildDrafts([{ id: 'a.webp', kind: 'Ring' }, { id: 'b.webp', kind: 'Ring' }, { id: 'c.webp', kind: 'Ring' }], pieces, {});
    expect(d.map(x => x.url)).toEqual(['https://taheri.shop/rings/a', '', '']);
  });

  it('writes the WhatsApp caption: name and weight, what it is, its page, and to DM for the price', () => {
    expect(storyCaption({ name: 'Mozambique Ruby Bangle Pair', weight: '62.9', kind: 'Ruby bangles · 21K gold', url: 'https://taheri.shop/b/x' }, ['+923352275553', '+923262275554'])).toBe([
      '✨ *Mozambique Ruby Bangle Pair* — _62.9g_',
      '_Ruby bangles · 21K gold_',
      '🌐 See it: *https://taheri.shop/b/x*',
      '',
      '*DM us for the current price*',
      '💬 WhatsApp: +923352275553, +923262275554',
    ].join('\n'));
    // No weight, no page, no numbers: only what there is.
    expect(storyCaption({ name: 'Taweez', weight: '', kind: 'Taweez', url: '' }, [])).toBe('✨ *Taweez*\n_Taweez_\n\n*DM us for the current price*');
  });
});

// ── The photograph's corners ──────────────────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number];
const GREEN: RGB = [20, 60, 42];
const WHITE: RGB = [240, 240, 240];
const GOLD: RGB = [230, 180, 60];
const BEIGE: RGB = [215, 205, 190];

function image(w: number, fill: RGB): Pixels & { at: (x: number, y: number) => RGB; paint: (x: number, y: number, ww: number, hh: number, c: RGB) => void } {
  const data = new Uint8ClampedArray(w * w * 4);
  for (let i = 0; i < w * w; i++) { data[i * 4] = fill[0]; data[i * 4 + 1] = fill[1]; data[i * 4 + 2] = fill[2]; data[i * 4 + 3] = 255; }
  const px = { width: w, height: w, data };
  return {
    ...px,
    at: (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; },
    paint: (x, y, ww, hh, c) => {
      for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) { const i = (yy * w + xx) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
    },
  };
}

/** "Lettering": thin bars, a few pixels wide, the way a printed weight or the wordmark reads at this size. */
function letters(img: ReturnType<typeof image>, x: number, y: number, c: RGB, n = 6) {
  for (let i = 0; i < n; i++) { img.paint(x + i * 12, y, 3, 30, c); img.paint(x + i * 12, y + 13, 9, 3, c); }
}

describe('cleaning the corners', () => {
  it('covers a printed weight top left and the wordmark top right on plain cloth', () => {
    const img = image(400, GREEN);
    letters(img, 16, 16, WHITE);
    letters(img, 320, 14, WHITE);
    const plans = cleanCorners(img);
    expect(plans.map(p => p.corner).sort()).toEqual(['tl', 'tr']);
    for (const [x, y] of [[17, 20], [22, 29], [321, 20]]) expect(img.at(x, y)).toEqual(GREEN);
  });

  it('leaves a corner with nothing written in it alone', () => {
    const img = image(400, GREEN);
    expect(planCorners(img)).toEqual([]);
  });

  it('with gold beside the lettering, fills only the lettering and leaves the gold', () => {
    const img = image(400, GREEN);
    letters(img, 16, 16, WHITE);
    img.paint(80, 4, 20, 40, GOLD);
    const [plan] = planCorners(img);
    expect(plan).toMatchObject({ corner: 'tl', from: null });
    cleanCorners(img);
    expect(img.at(17, 20)).not.toEqual(WHITE);
    expect(img.at(90, 20)).toEqual(GOLD);
  });

  it('reads dark lettering on a light ground', () => {
    const img = image(400, WHITE);
    letters(img, 16, 16, [70, 70, 70]);
    const [plan] = planCorners(img);
    expect(plan).toMatchObject({ corner: 'tl', ink: 'dark' });
  });

  it('does not take a light bust or wall beside the lettering for lettering', () => {
    const img = image(400, GREEN);
    letters(img, 16, 16, WHITE);
    img.paint(95, 0, 120, 80, BEIGE);
    cleanCorners(img);
    expect(img.at(17, 20)).not.toEqual(WHITE);
    // The bust is untouched, even its edge.
    expect(img.at(96, 10)).toEqual(BEIGE);
    expect(img.at(150, 40)).toEqual(BEIGE);
  });
});
