import { describe, expect, it } from 'vitest';
import { dragShadeEnd, freshPlacement, panPhoto, photoBox, shadeEnds, shadePresetOf, SHADE_PRESETS, withShade, zoomPhotoAt } from './bg-gesture';
import type { StoryDoc } from './editor';

const frame = { w: 1080, h: 1350 };
const tall = { w: 2000, h: 3000 };           // 2:3 photo in a 4:5 frame: room to move only up and down
import type { Placement } from './story';
const fill: Placement = { mode: 'fill', zoom: 1, focusX: 0.5, focusY: 0.5 };
const leftTop = (img: typeof tall, p: Placement) => { const b = photoBox(img, frame, p); return { x: -b.spareX * p.focusX, y: -b.spareY * p.focusY, ...b }; };

describe('panPhoto', () => {
  it('moves the photo exactly as far as the finger', () => {
    const p = panPhoto(tall, frame, fill, fill, 0, 60);
    expect(leftTop(tall, p).y - leftTop(tall, fill).y).toBeCloseTo(60, 1);
  });
  it('leaves an axis with no room alone instead of jumping to an edge', () => {
    const p = panPhoto(tall, frame, fill, fill, 300, 0);
    expect(p.focusX).toBe(0.5);
  });
  it('stops at the photo’s edge', () => {
    expect(panPhoto(tall, frame, fill, fill, 0, 5000).focusY).toBe(0);
    expect(panPhoto(tall, frame, fill, fill, 0, -5000).focusY).toBe(1);
  });
  it('moves a whole (fit) photo with the finger too', () => {
    const fit: Placement = { ...fill, mode: 'fit' };
    const p = panPhoto(tall, frame, fit, fit, 50, 0);
    expect(leftTop(tall, p).x - leftTop(tall, fit).x).toBeCloseTo(50, 1);
  });
});

describe('zoomPhotoAt', () => {
  it('keeps the spot under the pointer still', () => {
    const at = { x: 800, y: 300 };
    const a = leftTop(tall, fill);
    const u = (at.x - a.x) / a.dw, v = (at.y - a.y) / a.dh;
    const z = zoomPhotoAt(tall, frame, fill, 2, at.x, at.y);
    const b = leftTop(tall, z);
    expect(b.x + u * b.dw).toBeCloseTo(at.x, 0);
    expect(b.y + v * b.dh).toBeCloseTo(at.y, 0);
  });
  it('stays between 1× and 6×, and the photo always covers the frame', () => {
    expect(zoomPhotoAt(tall, frame, fill, 0.2, 0, 0).zoom).toBe(1);
    expect(zoomPhotoAt(tall, frame, fill, 40, 0, 0).zoom).toBe(6);
    const z = zoomPhotoAt(tall, frame, fill, 3, 1080, 1350);
    expect(z.focusX).toBeGreaterThanOrEqual(0); expect(z.focusX).toBeLessThanOrEqual(1);
  });
});

describe('a new background', () => {
  it('starts centred and unzoomed', () => {
    expect(freshPlacement({ ...fill, zoom: 2.4, focusX: 0.1, focusY: 0.9 })).toEqual(fill);
  });
});

describe('one shade', () => {
  const bg = { photoId: 'photo', placement: fill, dim: 0, gradient: 'bottom', color: '#000' } as StoryDoc['bg'];
  it('a quick choice clears the old preset gradient so the two never stack', () => {
    const b = withShade(bg, SHADE_PRESETS[1].shade);
    expect(b.gradient).toBe('none');
    expect(shadePresetOf(b)).toBe('bottom');
  });
  it('a hand-tuned shade matches no quick choice', () => {
    expect(shadePresetOf({ ...bg, shade: { ...SHADE_PRESETS[1].shade!, start: 0.33 } })).toBeNull();
  });
  it('dragging a handle moves where the fade starts, never past where it ends', () => {
    const g = SHADE_PRESETS[1].shade!;              // top to bottom, 0.5 → 1
    const { start } = shadeEnds(g, frame);
    expect(start.y).toBeCloseTo(675, 0);
    expect(dragShadeEnd(g, frame, 'start', 540, 270).start).toBeCloseTo(0.2, 2);
    expect(dragShadeEnd(g, frame, 'start', 540, 1350).start).toBe(g.end);
  });
});
