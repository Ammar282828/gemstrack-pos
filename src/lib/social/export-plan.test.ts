import { describe, expect, it } from 'vitest';
import {
  canBeTransparent, crc32, dosDateTime, exportName, exportSize, MAX_EXPORT_AREA, pdfPageSize, planExport, qualityFor, zipStore, type ExportChoice,
} from './export-plan';

const story = { w: 1080, h: 1920 }, square = { w: 1080, h: 1080 };

describe('export size', () => {
  it('multiplies the frame by the scale', () => {
    expect(exportSize(story, 1)).toMatchObject({ w: 1080, h: 1920, capped: false });
    expect(exportSize(square, 2)).toMatchObject({ w: 2160, h: 2160, capped: false });
  });
  it('holds a huge export inside what a canvas can draw', () => {
    const s = exportSize(story, 3);   // 3240 × 5760 = 18.7 M pixels
    expect(s.capped).toBe(true);
    expect(s.w * s.h).toBeLessThanOrEqual(MAX_EXPORT_AREA);
    expect(s.h).toBeLessThanOrEqual(8192);
    expect(Math.abs(s.w / s.h - 1080 / 1920)).toBeLessThan(0.002);
    expect(exportSize(square, 3).capped).toBe(false);
  });
});

describe('PDF pages', () => {
  it('sizes a page from its pixels at 300 dpi', () => {
    expect(pdfPageSize(3000, 3000).mm).toEqual([254, 254]);
    expect(pdfPageSize(2480, 3508).mm).toEqual([209.97, 297.01]);
    expect(pdfPageSize(300, 300).pt).toEqual([72, 72]);
    expect(pdfPageSize(1920, 1080).landscape).toBe(true);
    expect(pdfPageSize(1080, 1920).landscape).toBe(false);
  });
});

describe('format rules', () => {
  it('lets only PNG and WebP be transparent', () => {
    expect(canBeTransparent('png')).toBe(true);
    expect(canBeTransparent('webp')).toBe(true);
    expect(canBeTransparent('jpg')).toBe(false);
    expect(canBeTransparent('pdf')).toBe(false);
  });
  it('gives quality only to lossy formats, held to 0.5–1', () => {
    expect(qualityFor('png', 90)).toBeUndefined();
    expect(qualityFor('jpg', 90)).toBe(0.9);
    expect(qualityFor('jpg', 10)).toBe(0.5);
    expect(qualityFor('webp', 150)).toBe(1);
  });
});

describe('file names', () => {
  it('names a page and marks the scale', () => {
    expect(exportName('Ruby Ring!', 'Story', 2, 'png')).toBe('ruby-ring-story@2x.png');
    expect(exportName('', '', 1, 'jpg')).toBe('design.jpg');
  });
  it('never repeats a name', () => {
    const taken = new Set<string>();
    expect(exportName('a', 'x', 1, 'png', taken)).toBe('a-x.png');
    expect(exportName('a', 'x', 1, 'png', taken)).toBe('a-x-2.png');
  });
});

describe('the plan', () => {
  const pages = [{ key: 'story', label: 'Story', frame: story }, { key: 'square', label: 'Post', frame: square }];
  const base: ExportChoice = { format: 'png', scale: 1, quality: 90, transparent: false, pages: ['story'], bundle: 'zip' };
  it('one page is one file', () => {
    const p = planExport('Ring', pages, base);
    expect(p.kind).toBe('single');
    expect(p.files).toEqual(['ring.png']);
    expect(p.items[0]).toMatchObject({ w: 1080, h: 1920 });
  });
  it('several pages zip or download one by one', () => {
    const both = { ...base, pages: ['story', 'square'] };
    expect(planExport('Ring', pages, both)).toMatchObject({ kind: 'zip', files: ['ring-pages.zip'] });
    const seq = planExport('Ring', pages, { ...both, bundle: 'each' });
    expect(seq.kind).toBe('sequence');
    expect(seq.files).toEqual(['ring-story.png', 'ring-post.png']);
  });
  it('a PDF is one file whatever the pages', () => {
    const p = planExport('Ring', pages, { ...base, format: 'pdf', pages: ['story', 'square'] });
    expect(p).toMatchObject({ kind: 'pdf', files: ['ring.pdf'] });
    expect(p.items).toHaveLength(2);
  });
  it('drops transparency where the format cannot hold it, and says when it shrank the picture', () => {
    expect(planExport('r', pages, { ...base, format: 'jpg', transparent: true }).transparent).toBe(false);
    expect(planExport('r', pages, { ...base, transparent: true }).transparent).toBe(true);
    expect(planExport('r', pages, { ...base, scale: 3 }).note).toMatch(/Brought down/);
  });
  it('plans nothing when no page is chosen', () => {
    expect(planExport('r', pages, { ...base, pages: [] }).kind).toBe('none');
  });
});

describe('zip', () => {
  it('has the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  it('packs the DOS date and time', () => {
    expect(dosDateTime(new Date(2026, 9, 12, 14, 30, 10))).toEqual({ time: (14 << 11) | (30 << 5) | 5, date: ((2026 - 1980) << 9) | (10 << 5) | 12 });
  });
  it('writes a zip whose directory points at every file', () => {
    const files = [{ name: 'a.txt', data: new TextEncoder().encode('hello') }, { name: 'é.bin', data: new Uint8Array([1, 2, 3]) }];
    const z = zipStore(files, new Date(2026, 0, 2, 3, 4, 6));
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // End of central directory, 22 bytes from the end.
    const e = z.length - 22;
    expect(v.getUint32(e, true)).toBe(0x06054b50);
    expect(v.getUint16(e + 10, true)).toBe(2);
    const cenSize = v.getUint32(e + 12, true), cenAt = v.getUint32(e + 16, true);
    expect(cenAt + cenSize).toBe(e);
    // First local header: stored, with the right size and CRC, then the bytes.
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(8, true)).toBe(0);
    expect(v.getUint32(14, true)).toBe(crc32(files[0].data));
    expect(v.getUint32(18, true)).toBe(5);
    expect(new TextDecoder().decode(z.slice(30 + 5, 30 + 5 + 5))).toBe('hello');
    // Central directory entries: offsets lead back to local headers.
    expect(v.getUint32(cenAt, true)).toBe(0x02014b50);
    expect(v.getUint32(cenAt + 42, true)).toBe(0);
    const nameLen = v.getUint16(cenAt + 28, true);
    const second = cenAt + 46 + nameLen;
    expect(v.getUint32(second, true)).toBe(0x02014b50);
    expect(v.getUint32(v.getUint32(second + 42, true), true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(z.slice(second + 46, second + 46 + v.getUint16(second + 28, true)))).toBe('é.bin');
  });
  it('writes an empty zip', () => {
    const z = zipStore([]);
    expect(z.length).toBe(22);
  });
});
