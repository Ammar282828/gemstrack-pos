import { describe, expect, it } from 'vitest';
import { base64Decode, base64Encode, bitmapHex, hexOf, rasterToBitmap, rotateBitmap } from '@/lib/label-bitmap';
import { decodePng, decodePngDataUrl, inflate } from '@/lib/png-decode';
import { PNG_24X20, PNG_8X2 } from '@/lib/test-fixtures/label-png';

// Mirrored by ERPCore's LabelBitmapTests.swift with the same pictures and the same bits.
describe('base64', () => {
  it('encodes and decodes, with or without padding', () => {
    expect(base64Encode([])).toBe('');
    expect(base64Encode([0x61])).toBe('YQ==');
    expect(base64Encode([0x61, 0x62])).toBe('YWI=');
    expect(base64Encode([0x61, 0x62, 0x63])).toBe('YWJj');
    expect(Array.from(base64Decode('YWJj')!)).toEqual([0x61, 0x62, 0x63]);
    expect(Array.from(base64Decode('YW I=\n')!)).toEqual([0x61, 0x62]);
    expect(Array.from(base64Decode('YQ')!)).toEqual([0x61]);
    expect(base64Decode('YQ=x')).toBeNull();
    expect(base64Decode('a$b')).toBeNull();
    expect(hexOf([0, 15, 16, 255])).toBe('000F10FF');
  });
});

describe('bitmaps', () => {
  it('turns a picture by quarter turns', () => {
    // 3 × 2:  1 0 0 / 0 1 1  (rows 100.. and 011..)
    const bytes = Uint8Array.from([0b10000000, 0b01100000]);
    const half = rotateBitmap(bytes, 3, 2, 2);
    expect([half.width, half.height, Array.from(half.bytes)]).toEqual([3, 2, [0b11000000, 0b00100000]]);
    const quarter = rotateBitmap(bytes, 3, 2, 1);
    // Clockwise: 2 wide, 3 tall. Rows: 0 1 / 1 0 / 1 0
    expect([quarter.width, quarter.height, Array.from(quarter.bytes)]).toEqual([2, 3, [0b01000000, 0b10000000, 0b10000000]]);
    const three = rotateBitmap(bytes, 3, 2, 3);
    expect([three.width, three.height, Array.from(three.bytes)]).toEqual([2, 3, [0b01000000, 0b01000000, 0b10000000]]);
    expect(rotateBitmap(bytes, 3, 2, 4).bytes).toBe(bytes);
  });
  it('gives the ^GFA hex, padded or cut to the size', () => {
    expect(bitmapHex('qoDAwA==', 10, 2, false)).toEqual({ hex: 'AA80C0C0', total: 4, bytesPerRow: 2 });
    expect(bitmapHex('qoDAwA==', 10, 1, false)).toEqual({ hex: 'AA80', total: 2, bytesPerRow: 2 });
    expect(bitmapHex('qg==', 10, 2, true)).toEqual({ hex: '00001540', total: 4, bytesPerRow: 2 });
    expect(bitmapHex('***', 8, 1, false)).toBeNull();
  });
  it('makes a bitmap from pixels: grey laid on white, clear counts as white', () => {
    const png = decodePngDataUrl(`data:image/png;base64,${PNG_8X2}`)!;
    expect([png.width, png.height]).toEqual([8, 2]);
    const b = rasterToBitmap(png.rgba, 8, 2, 8, 2);
    // black white clear 100 200 black black white / white black black white clear 100 200 black
    expect(b).toBe('lmU=');
    expect(bitmapHex(b, 8, 2, false)!.hex).toBe('9665');
    // Squeezed to 4 × 1, a dot averages a 2 × 2 block: only the last, at 45% grey, is darker than half.
    expect(bitmapHex(rasterToBitmap(png.rgba, 8, 2, 4, 1), 4, 1, false)!.hex).toBe('10');
    // A lower threshold prints less; brightness lifts the greys.
    expect(bitmapHex(rasterToBitmap(png.rgba, 8, 2, 8, 2, { threshold: 0.3 }), 8, 2, false)!.hex).toBe('8661');
    expect(bitmapHex(rasterToBitmap(png.rgba, 8, 2, 8, 2, { brightness: 0.2 }), 8, 2, false)!.hex).toBe('8661');
    // Blown up, each pixel is several dots.
    expect(bitmapHex(rasterToBitmap(png.rgba, 8, 2, 16, 2), 16, 2, false)!.hex).toBe('C33C3C33');
  });
  it('dithers a grey ramp the way Atkinson and Floyd-Steinberg do', () => {
    const grey = [0, 36, 72, 108, 144, 180, 216, 252];
    const rgba = Uint8Array.from([...grey, ...grey].flatMap((g) => [g, g, g, 255]));
    const bits = (dither?: 'threshold' | 'atkinson' | 'floyd') => bitmapHex(rasterToBitmap(rgba, 8, 2, 8, 2, { dither }), 8, 2, false)!.hex;
    expect(bits()).toBe('F0F0');
    expect(bits('atkinson')).toBe('F0E4');
    expect(bits('floyd')).toBe('E8E8');
  });
});

describe('PNG', () => {
  it('inflates a stored block', () => {
    const z = Uint8Array.from([0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0xff, 0x61, 0x62, 0x63, 0x02, 0x4d, 0x01, 0x27]);
    expect(Array.from(inflate(z)!)).toEqual([0x61, 0x62, 0x63]);
    expect(inflate(Uint8Array.from([0x78, 0x01, 0x01, 0x03, 0x00, 0xfc, 0x00, 0x61]))).toBeNull();
    expect(inflate(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
  it('reads every pixel through dynamic Huffman codes and all five filters', () => {
    const img = decodePng(base64Decode(PNG_24X20)!)!;
    expect([img.width, img.height]).toEqual([24, 20]);
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 24; x++) {
        const i = (y * 24 + x) * 4;
        expect([img.rgba[i], img.rgba[i + 1], img.rgba[i + 2], img.rgba[i + 3]]).toEqual([(x * 10) & 255, (y * 12) & 255, (x * y) & 255, 255]);
      }
    }
  });
  it('gives null for what it cannot read', () => {
    expect(decodePng(Uint8Array.from([1, 2, 3]))).toBeNull();
    expect(decodePngDataUrl('data:text/plain;base64,AAAA')).toBeNull();
    expect(decodePngDataUrl('https://example.test/a.png')).toBeNull();
    const cut = base64Decode(PNG_24X20)!.slice(0, 120);
    expect(decodePng(cut)).toBeNull();
    expect(decodePngDataUrl('data:image/*;base64,!!!')).toBeNull();
  });
});
