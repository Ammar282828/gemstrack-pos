import { describe, expect, it } from 'vitest';
import { panInFrame, type ImageLayer } from './editor';

const img = { naturalWidth: 2000, naturalHeight: 1000 } as unknown as HTMLImageElement;
const frame = (iz?: number): ImageLayer => ({ id: 'f', kind: 'image', photoId: 'p', x: 0, y: 0, w: 500, h: 500, iz, radius: 0, border: null, shadow: false, rotate: 0, opacity: 1 } as ImageLayer);

describe('panInFrame', () => {
  it('a wide photo in a square frame slides sideways only', () => {
    // Covering 500×500 makes it 1000×500: 500 px to spare across, none down.
    expect(panInFrame(frame(), img, 0.5, 0.5, 100, 100)).toEqual({ fx: 0.3, fy: 0.5 });
  });
  it('stops at the edges', () => expect(panInFrame(frame(), img, 0.5, 0.5, -10000, 0).fx).toBe(1));
  it('zoomed in, it moves down as well', () => expect(panInFrame(frame(2), img, 0.5, 0.5, 0, 100).fy).toBe(0.3));
});
