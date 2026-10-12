import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import { dataCodewords, encodeData, formatBits, interleave, qrFor, qrMatrix, qrVersionFor, reedSolomon, type QrEcc } from './qr';

/** The reference implementation (the `qrcode` package the app already depends on), forced to our version and mask. */
function reference(text: string, mode: 'byte' | 'alphanumeric', ecc: QrEcc, version: number, mask: number): boolean[][] {
  const q = QRCode.create([{ data: text, mode }] as never, { errorCorrectionLevel: ecc, version, maskPattern: mask } as never) as unknown as { modules: { size: number; data: Uint8Array } };
  const n = q.modules.size;
  return Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => !!q.modules.data[y * n + x]));
}

describe('QR encoder: published vectors', () => {
  // The "HELLO WORLD" example every QR tutorial walks through (version 1).
  it('makes the check words of HELLO WORLD at level M', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(encodeData('HELLO WORLD', 1, 'M')).toEqual(data);
    expect(reedSolomon(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('makes the data and check words of HELLO WORLD at level Q', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
    expect(encodeData('HELLO WORLD', 1, 'Q')).toEqual(data);
    expect(reedSolomon(data, 13)).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
  });
  it('codes the format information as the standard’s table does (mask 0)', () => {
    expect(formatBits('L', 0)).toBe(0b111011111000100);
    expect(formatBits('M', 0)).toBe(0b101010000010010);
    expect(formatBits('Q', 0)).toBe(0b011010101011111);
    expect(formatBits('H', 0)).toBe(0b001011010001001);
  });
  it('has the standard’s data capacities', () => {
    expect([1, 2, 3, 4, 5, 10].map(v => dataCodewords(v, 'M'))).toEqual([16, 28, 44, 64, 86, 216]);
    expect([1, 2, 5, 10].map(v => dataCodewords(v, 'L'))).toEqual([19, 34, 108, 274]);
    expect([1, 2, 5, 10].map(v => dataCodewords(v, 'H'))).toEqual([9, 16, 46, 122]);
    expect(qrVersionFor('HELLO WORLD', 'M')).toBe(1);
  });
});

describe('QR encoder: whole matrices', () => {
  const cases: { text: string; mode: 'byte' | 'alphanumeric'; ecc: QrEcc }[] = [
    { text: 'HELLO WORLD', mode: 'alphanumeric', ecc: 'M' },
    { text: 'HELLO WORLD', mode: 'alphanumeric', ecc: 'Q' },
    { text: 'https://wa.me/923001234567', mode: 'byte', ecc: 'M' },
    { text: 'https://taheri.shop/', mode: 'byte', ecc: 'H' },
    { text: 'Taheri — gold & diamond, Karachi', mode: 'byte', ecc: 'L' },
    // Long enough for several blocks and for the version information (version 7 and up).
    { text: 'https://erp.taheri.shop/view-invoice/' + 'abcdefghij'.repeat(12), mode: 'byte', ecc: 'M' },
    { text: 'x'.repeat(190), mode: 'byte', ecc: 'M' },
    { text: 'y'.repeat(260), mode: 'byte', ecc: 'L' },
  ];
  for (const c of cases) {
    it(`matches the reference module for module: ${c.text.slice(0, 24)}… (${c.ecc})`, () => {
      const m = qrMatrix(c.text, { ecc: c.ecc });
      expect(m.size).toBe(m.version * 4 + 17);
      expect(m.modules).toEqual(reference(c.text, c.mode, c.ecc, m.version, m.mask));
    });
  }

  it('matches the reference at every mask', () => {
    for (let mask = 0; mask < 8; mask++) {
      const m = qrMatrix('https://houseofmina.store', { ecc: 'M', mask });
      expect(m.mask).toBe(mask);
      expect(m.modules).toEqual(reference('https://houseofmina.store', 'byte', 'M', m.version, mask));
    }
  });

  it('picks the smallest version that holds the text, and grows with it', () => {
    expect(qrMatrix('hi').version).toBe(1);
    expect(qrMatrix('x'.repeat(14), { ecc: 'M' }).version).toBe(1); // 14 bytes fit version 1-M
    expect(qrMatrix('x'.repeat(15), { ecc: 'M' }).version).toBe(2);
    expect(qrMatrix('x'.repeat(213), { ecc: 'M' }).version).toBe(10);
  });

  it('draws the finder patterns and the dark module', () => {
    const m = qrMatrix('hello');
    const at = (x: number, y: number) => m.modules[y][x];
    for (const [ox, oy] of [[0, 0], [m.size - 7, 0], [0, m.size - 7]]) {
      expect(at(ox, oy)).toBe(true); expect(at(ox + 1, oy + 1)).toBe(false); expect(at(ox + 3, oy + 3)).toBe(true); expect(at(ox + 6, oy + 6)).toBe(true);
    }
    expect(at(8, m.size - 8)).toBe(true);
  });

  it('refuses what is too long, and says nothing for nothing', () => {
    expect(() => qrMatrix('z'.repeat(300))).toThrow(/too long/);
    expect(qrFor('')).toBeNull();
    expect(qrFor('z'.repeat(300))).toBeNull();
    expect(qrFor('https://taheri.shop')).not.toBeNull();
  });

  it('interleaves blocks like the standard (version 5-Q has four blocks)', () => {
    const data = encodeData('q'.repeat(40), 5, 'Q') as number[];
    const out = interleave(data, 5, 'Q');
    expect(out.length).toBe(134); // all the code words of a version 5 symbol
    expect(out[0]).toBe(data[0]);
    expect(out[1]).toBe(data[15]); // the second block starts 15 data words in (two blocks of 15, two of 16)
  });
});
