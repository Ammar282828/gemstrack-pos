import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/firebase-admin', () => ({ adminDb: {} }));
const { fitUpload } = await import('./uploads');

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
