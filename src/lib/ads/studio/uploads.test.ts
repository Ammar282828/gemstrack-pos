import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
const { fitUpload, svgDensity } = await import('./uploads');

const picture = (w: number, h: number, noise = false) =>
  sharp(noise ? Buffer.from(Array.from({ length: w * h * 3 }, () => Math.floor(Math.random() * 256))) : Buffer.alloc(w * h * 3, 200),
    { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();

describe('fitUpload', () => {
  it('keeps a small picture its size, as a JPEG', async () => {
    const out = await fitUpload(await picture(800, 600));
    expect([out.w, out.h]).toEqual([800, 600]);
    expect(out.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
  it('brings a large picture within 2400 px and under 900 KB', async () => {
    const out = await fitUpload(await picture(4000, 3000, true));
    expect(Math.max(out.w, out.h)).toBeLessThanOrEqual(2400);
    expect(out.data.length).toBeLessThanOrEqual(900 * 1024);
  });
  it('refuses a file that is not a picture', async () => {
    await expect(fitUpload(Buffer.from('not a picture'))).rejects.toMatchObject({ status: 400 });
  });
});

describe('fitUpload with transparency', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><circle cx="200" cy="100" r="60" fill="#c0392b"/></svg>');
  it('keeps an SVG logo transparent, as a PNG under 900 KB', async () => {
    const out = await fitUpload(svg);
    expect(out.type).toBe('image/png');
    expect(out.data.length).toBeLessThanOrEqual(900 * 1024);
    const { data, info } = await sharp(out.data).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(4);
    expect(data[3]).toBe(0);                                  // top-left corner: fully transparent
    const mid = ((info.height >> 1) * info.width + (info.width >> 1)) * 4;
    expect(data[mid + 3]).toBe(255);                          // the circle is solid
    expect(Math.max(out.w, out.h)).toBeLessThanOrEqual(2400);
  });
  it('keeps a transparent PNG transparent, and flattens an opaque RGBA one to a JPEG', async () => {
    const clear = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    expect((await fitUpload(clear)).type).toBe('image/png');
    const solid = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 9, g: 9, b: 9, alpha: 1 } } }).png().toBuffer();
    expect((await fitUpload(solid)).type).toBe('image/jpeg');
  });
  it('still stores a JPEG input as a JPEG', async () => {
    const jpg = await sharp(Buffer.alloc(200 * 100 * 3, 120), { raw: { width: 200, height: 100, channels: 3 } }).jpeg().toBuffer();
    const out = await fitUpload(jpg);
    expect(out.type).toBe('image/jpeg');
    expect(out.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });
});

describe('svgDensity', () => {
  it('aims the long side at 2400 px, between 72 and 300 dpi', () => {
    expect(svgDensity(4000)).toBe(72);
    expect(svgDensity(1000)).toBe(173);
    expect(svgDensity(100)).toBe(300);
  });
});
