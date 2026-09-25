import { describe, expect, it } from 'vitest';
import { FILTERS, MASK_PICKS, SHAPES, SHAPE_PICKS, alignDeltas, applyAdjust, changesPixels, distributeDeltas, isPlain, snapBox, snapLines, unionBox, NO_ADJUST } from './design';

describe('shapes', () => {
  it('draws every shape and frame as a closed path inside its box', () => {
    for (const key of [...SHAPE_PICKS, ...MASK_PICKS]) {
      const d = SHAPES[key].path(200, 100);
      expect(d.startsWith('M')).toBe(true);
      expect(d.trim().endsWith('Z')).toBe(true);
      // Every coordinate pair sits in the box (arc flags and radii aside).
      const nums = d.replace(/[A-Z]/g, ' ').trim().split(/\s+/).map(Number);
      expect(nums.every(n => Number.isFinite(n) && n >= 0 && n <= 200)).toBe(true);
    }
  });
});

describe('photo filters', () => {
  it('leaves pixels alone when nothing is set', () => {
    const px = new Uint8ClampedArray([10, 120, 250, 255]);
    applyAdjust(px, NO_ADJUST);
    expect([...px]).toEqual([10, 120, 250, 255]);
  });
  it('turns a colour grey at saturation −100 and keeps alpha', () => {
    const px = new Uint8ClampedArray([200, 100, 50, 128]);
    applyAdjust(px, { ...NO_ADJUST, saturation: -100 });
    expect(px[0]).toBe(px[1]);
    expect(px[1]).toBe(px[2]);
    expect(px[3]).toBe(128);
  });
  it('warms by adding red and taking blue', () => {
    const px = new Uint8ClampedArray([100, 100, 100, 255]);
    applyAdjust(px, { ...NO_ADJUST, warmth: 50 });
    expect(px[0]).toBeGreaterThan(100);
    expect(px[2]).toBeLessThan(100);
  });
  it('brightens and stays in range', () => {
    const px = new Uint8ClampedArray([250, 0, 128, 255]);
    applyAdjust(px, { ...NO_ADJUST, brightness: 100, contrast: 100 });
    expect(px[0]).toBe(255);
    expect(px[1]).toBeGreaterThanOrEqual(0);
  });
  it('knows a vignette alone does not touch the pixels', () => {
    expect(isPlain(NO_ADJUST)).toBe(true);
    expect(changesPixels({ ...NO_ADJUST, vignette: 50 })).toBe(false);
    expect(isPlain({ ...NO_ADJUST, vignette: 50 })).toBe(false);
    expect(FILTERS[0].id).toBe('original');
  });
});

describe('aligning', () => {
  const a = { x: 10, y: 10, w: 100, h: 50 }, b = { x: 300, y: 200, w: 40, h: 40 };
  it('lines several up with the selection’s own edge', () => {
    expect(alignDeltas([a, b], 'left')).toEqual([{ dx: 0, dy: 0 }, { dx: -290, dy: 0 }]);
    expect(alignDeltas([a, b], 'bottom')).toEqual([{ dx: 0, dy: 180 }, { dx: 0, dy: 0 }]);
  });
  it('centres one on the page', () => {
    expect(alignDeltas([a], 'center', { x: 0, y: 0, w: 1080, h: 1920 })).toEqual([{ dx: 480, dy: 0 }]);
    expect(alignDeltas([a], 'middle', { x: 0, y: 0, w: 1080, h: 1920 })).toEqual([{ dx: 0, dy: 925 }]);
  });
  it('spaces three evenly, the outer two staying', () => {
    const boxes = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 15, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 }];
    const d = distributeDeltas(boxes, 'h');
    expect(d[0].dx).toBe(0);
    expect(d[2].dx).toBe(0);
    expect(boxes[1].x + d[1].dx).toBe(50);
    expect(distributeDeltas(boxes.slice(0, 2), 'h')).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });
  it('wraps a selection in one box', () => {
    expect(unionBox([a, b])).toEqual({ x: 10, y: 10, w: 330, h: 230 });
  });
});

describe('magnetic guides', () => {
  const lines = snapLines({ w: 1080, h: 1920 }, 96, [{ x: 500, y: 700, w: 200, h: 100 }]);
  it('snaps a centre to the page centre', () => {
    const s = snapBox({ x: 437, y: 100, w: 200, h: 50 }, lines, 12);
    expect(s.dx).toBe(3);
    expect(s.v).toBe(540);
  });
  it('snaps an edge to another element’s edge', () => {
    const s = snapBox({ x: 20, y: 795, w: 60, h: 60 }, lines, 12);
    expect(s.dy).toBe(5);
    expect(s.h).toBe(800);
  });
  it('leaves it alone when nothing is near', () => {
    expect(snapBox({ x: 300, y: 300, w: 10, h: 10 }, lines, 12)).toEqual({ dx: 0, dy: 0, v: null, h: null });
  });
});
