import { describe, expect, it } from 'vitest';
import { isOnlineId, newOnlineId, shopOpen } from './online';
import { parseSlipFile } from './slips';

describe('online order numbers', () => {
  it('are ONL- and six characters a customer can read out', () => {
    const id = newOnlineId(Buffer.from([0, 1, 2, 3, 4, 255]));
    expect(id).toMatch(/^ONL-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    expect(isOnlineId(id)).toBe(true);
    for (let i = 0; i < 50; i++) expect(newOnlineId().slice(4)).not.toMatch(/[01IOL]/);
    expect(isOnlineId('ORD-000123')).toBe(false);
  });
});

describe('shopOpen', () => {
  // Karachi is UTC+5 all year.
  const at = (iso: string) => new Date(iso);
  it('is Saturday to Thursday 11 to 9, Friday 3 to 8', () => {
    expect(shopOpen(at('2026-10-05T06:30:00Z'))).toBe(true);   // Mon 11:30
    expect(shopOpen(at('2026-10-05T05:30:00Z'))).toBe(false);  // Mon 10:30
    expect(shopOpen(at('2026-10-05T16:30:00Z'))).toBe(false);  // Mon 21:30
    expect(shopOpen(at('2026-10-09T07:00:00Z'))).toBe(false);  // Fri 12:00
    expect(shopOpen(at('2026-10-09T10:30:00Z'))).toBe(true);   // Fri 15:30
  });
});

describe('parseSlipFile', () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 1)]);
  it('takes a picture or a PDF as it says it is', () => {
    expect(parseSlipFile(`data:image/jpeg;base64,${jpeg.toString('base64')}`).contentType).toBe('image/jpeg');
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(400, 32)]);
    expect(parseSlipFile(`data:application/pdf;base64,${pdf.toString('base64')}`).contentType).toBe('application/pdf');
  });
  it('refuses a renamed file, another type, an empty one and a huge one', () => {
    expect(() => parseSlipFile(`data:image/png;base64,${jpeg.toString('base64')}`)).toThrow(/not the picture/);
    expect(() => parseSlipFile(`data:text/html;base64,${jpeg.toString('base64')}`)).toThrow(/picture/);
    expect(() => parseSlipFile('data:image/jpeg;base64,/9g=')).toThrow(/empty/);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(950_000)]);
    expect(() => parseSlipFile(`data:image/jpeg;base64,${big.toString('base64')}`)).toThrow(/too large/);
    expect(() => parseSlipFile('nonsense')).toThrow();
  });
});
