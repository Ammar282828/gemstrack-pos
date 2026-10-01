import { describe, it, expect } from 'vitest';
import { rateBoard } from './templates';

describe('rateBoard', () => {
  it('turns per-gram rates into per-tola rows, rounded to the hundred', () => {
    const b = rateBoard({ k24: 45_000, k22: 41_250, k21: 39_375, k18: 0 }, 'Tuesday 30 September');
    expect(b.date).toBe('Tuesday 30 September');
    expect(b.rows).toEqual([
      { label: '24K', perTola: 524_900 },
      { label: '22K', perTola: 481_100 },
      { label: '21K', perTola: 459_300 },
    ]);
  });
  it('leaves out a karat the shop has not set', () => {
    expect(rateBoard({ k21: 39_375 }, '').rows.map(r => r.label)).toEqual(['21K']);
    expect(rateBoard({}, '').rows).toEqual([]);
  });
});

import { AD_FORMATS, customFormat, formatInfo, isAdFormat, metaFeedFit, nearestAiRatio, ratioOfFrame, reduceRatio } from './templates';

describe('any shape', () => {
  it('draws every fixed shape at a ratio the image model has', () => {
    for (const f of Object.values(AD_FORMATS)) expect(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']).toContain(f.ai);
  });
  it('gives each fixed shape the frame its name says', () => {
    for (const f of Object.values(AD_FORMATS)) {
      if (f.short === '1.91:1') continue; // Meta's link ad, 1200×628
      const [w, h] = f.short.split(':').map(Number);
      expect(Math.abs(f.frame.h - (1080 * h) / w)).toBeLessThan(1);
    }
  });
  it('picks the nearest model ratio', () => {
    expect(nearestAiRatio(1080, 1350)).toBe('4:5');
    expect(nearestAiRatio(7, 3)).toBe('21:9');
    expect(nearestAiRatio(1, 2)).toBe('9:16');
  });
  it('makes a custom frame 1080 wide and exports its short side at 1080 or more', () => {
    const wide = customFormat(7, 3);
    expect(wide.frame).toEqual({ w: 1080, h: 463 });
    expect(Math.round((wide.px * wide.frame.h) / wide.frame.w)).toBeGreaterThanOrEqual(1080);
    expect(customFormat(1, 3).frame.h).toBe(2400); // clamped
    expect(customFormat(4, 5).label).toBe('Custom 4:5');
    expect(customFormat(8, 10).short).toBe('4:5');
  });
  it('reads a saved custom frame back as the W:H it was made from', () => {
    expect(ratioOfFrame(customFormat(7, 3).frame)).toEqual({ w: 7, h: 3 });
    expect(ratioOfFrame(customFormat(13, 17).frame)).toEqual({ w: 13, h: 17 });
    expect(reduceRatio(1080, 1350)).toEqual({ w: 4, h: 5 });
  });
  it('says how Meta shows a shape in feeds', () => {
    expect(metaFeedFit(AD_FORMATS.r16x9.frame)).toBe('as-is');
    expect(metaFeedFit(AD_FORMATS.portrait.frame)).toBe('as-is');
    expect(metaFeedFit(AD_FORMATS.r2x3.frame)).toBe('4:5');
    expect(metaFeedFit(AD_FORMATS.r21x9.frame)).toBe('1.91:1');
  });
  it('knows its own formats', () => {
    expect(isAdFormat('custom')).toBe(true);
    expect(isAdFormat('r3x2')).toBe(true);
    expect(isAdFormat('toString')).toBe(false);
    expect(formatInfo('custom', { w: 3, h: 1 }).frame.h).toBe(360);
  });
});
