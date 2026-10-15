import { describe, expect, it } from 'vitest';
import { AD_FORMATS, safeZone } from '@/lib/ads/studio/templates';
import { metaCrop, overlayRects, safeBands, safeKindsFor, safeRect } from './safe';

describe('safe bands', () => {
  it('are a Story’s for a 9:16: the top 14% and the bottom fifth (a Reel keeps 35%)', () => {
    const f = AD_FORMATS.story.frame;
    const z = safeZone(f);
    expect(safeBands(f)).toEqual({ top: z.top, bottom: Math.round(1920 * 0.2), left: 0, right: 0 });
    expect(safeBands(f, 'reel').bottom).toBe(Math.round(1920 * 0.35));
    expect(z.top).toBe(Math.round(1920 * 0.14));
    expect(z.bottom).toBe(Math.round(1920 * 0.35));
  });

  it('are none on a feed shape', () => {
    expect(safeBands(AD_FORMATS.portrait.frame)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    expect(safeRect(AD_FORMATS.square.frame)).toEqual({ x: 0, y: 0, w: 1080, h: 1080 });
  });

  it('keep a reel’s right side clear too, and a tall post to its grid square', () => {
    expect(safeBands(AD_FORMATS.story.frame, 'reel').right).toBe(162);
    expect(safeBands(AD_FORMATS.portrait.frame, 'feed-grid')).toMatchObject({ top: 135, bottom: 135 });
  });

  it('draws the bands as boxes', () => {
    const boxes = overlayRects(AD_FORMATS.story.frame);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toEqual({ x: 0, y: 0, w: 1080, h: 269 });
    expect(boxes[1].y + boxes[1].h).toBe(1920);
    expect(overlayRects(AD_FORMATS.square.frame)).toEqual([]);
  });

  it('says how Meta crops a feed picture', () => {
    expect(metaCrop(AD_FORMATS.square.frame).fit).toBe('as-is');
    expect(metaCrop(AD_FORMATS.story.frame)).toMatchObject({ fit: '4:5', rect: { x: 0, y: 285, w: 1080, h: 1350 } });
    expect(metaCrop(AD_FORMATS.r21x9.frame)).toMatchObject({ fit: '1.91:1', rect: { w: 884, h: 463 } });
  });

  it('offers the kinds that fit a frame', () => {
    expect(safeKindsFor(AD_FORMATS.story.frame)).toEqual(['story', 'reel']);
    expect(safeKindsFor(AD_FORMATS.square.frame)).toEqual([]);
  });
});
