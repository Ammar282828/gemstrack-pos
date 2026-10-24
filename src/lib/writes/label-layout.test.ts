import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { cleanLabelLayout, MAX_IMAGE_TEXT, saveLabelLayout, STANDARD_LABEL_LAYOUT } from './label-layout';

describe('STANDARD_LABEL_LAYOUT', () => {
  it('is the page\'s own default tag, until the page imports it from here', () => {
    const page = fs.readFileSync(path.resolve(__dirname, '../../app/settings/printer/page.tsx'), 'utf8');
    const block = page.slice(page.indexOf('const defaultLayout'), page.indexOf('// --- Components ---'));
    for (const v of ["'zebra-2000t-jewellery'", "'Zebra 2000T Jewellery Tag (83x37mm)'", 'widthDots: 664', 'heightDots: 296',
      "id: 'sku-left'", 'x: 100, y: 150', "data: 'SKU: {sku}'", 'fontSize: 20', 'rotation: 90',
      "id: 'qr-right'", 'x: 450, y: 80', "data: '{sku}'", 'qrMagnification: 4']) {
      expect(block).toContain(v);
    }
    expect(cleanLabelLayout(STANDARD_LABEL_LAYOUT)).toEqual({ ok: true, layout: STANDARD_LABEL_LAYOUT });
  });
});

describe('cleanLabelLayout', () => {
  it('keeps the fields the designer knows and drops the rest', () => {
    const r = cleanLabelLayout({
      ...STANDARD_LABEL_LAYOUT, extra: 'x',
      fields: [{ id: ' f1 ', type: 'text', x: 10, y: 12, data: 'Price', fontSize: 18, rotation: 180, colour: 'red' }],
    });
    expect(r).toEqual({ ok: true, layout: { ...STANDARD_LABEL_LAYOUT, fields: [{ id: 'f1', type: 'text', x: 10, y: 12, data: 'Price', fontSize: 18, rotation: 180 }] } });
  });

  it('refuses what the designer could not have made', () => {
    const field = { id: 'a', type: 'text', x: 1, y: 1, data: 'A' };
    for (const fields of [
      'x', [null], [{ ...field, type: 'hologram' }], [{ ...field, x: '1' }], [{ ...field, rotation: 45 }], [{ ...field, fontSize: 0 }],
      [{ ...field, data: 7 }], [field, field], [{ ...field, id: '' }], Array.from({ length: 201 }, (_, i) => ({ ...field, id: `f${i}` })),
    ]) {
      expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, fields }).ok).toBe(false);
    }
    expect(cleanLabelLayout(null).ok).toBe(false);
    expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, widthDots: 0 }).ok).toBe(false);
    expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, id: '' }).ok).toBe(false);
  });
});

describe('cleanLabelLayout: what the designer adds', () => {
  const base = { ...STANDARD_LABEL_LAYOUT, fields: [] };
  const field = (extra: Record<string, unknown>) => ({ id: 'f', x: 5, y: 6, ...extra });
  const kept = (extra: Record<string, unknown>) => {
    const r = cleanLabelLayout({ ...base, fields: [field(extra)] });
    return r.ok ? r.layout.fields[0] : r.error;
  };
  const refused = (extra: Record<string, unknown>) => cleanLabelLayout({ ...base, fields: [field(extra)] }).ok === false;

  it('keeps an older layout exactly as it was, adding nothing', () => {
    const old = { id: 'o', name: 'Old', widthDots: 300, heightDots: 200, fields: [
      { id: 'a', type: 'text', x: 1, y: 2, data: 'Hi {sku}', fontSize: 20, fontFamily: '0', rotation: 90 },
      { id: 'b', type: 'qr', x: 3, y: 4, data: '{sku}', qrMagnification: 3 },
    ] };
    expect(cleanLabelLayout(old)).toEqual({ ok: true, layout: old });
  });
  it('keeps what each type knows and drops the rest', () => {
    expect(kept({ type: 'text', data: 'A', width: 100, lines: 2, lineSpacing: -3, align: 'R', bold: true, hidden: true, locked: false, name: 'Title', height: 9, symbology: 'code39' }))
      .toEqual({ id: 'f', type: 'text', x: 5, y: 6, data: 'A', width: 100, lines: 2, lineSpacing: -3, align: 'R', bold: true, hidden: true, locked: false, name: 'Title' });
    expect(kept({ type: 'qr', data: '{sku}', errorCorrection: 'H', qrMagnification: 4, align: 'C' })).toEqual({ id: 'f', type: 'qr', x: 5, y: 6, data: '{sku}', qrMagnification: 4, errorCorrection: 'H' });
    expect(kept({ type: 'barcode', data: '{sku}', symbology: 'ean13', height: 55, moduleWidth: 3, showText: true, errorCorrection: 'H' }))
      .toEqual({ id: 'f', type: 'barcode', x: 5, y: 6, data: '{sku}', symbology: 'ean13', height: 55, moduleWidth: 3, showText: true });
    expect(kept({ type: 'line', width: 100, height: 3, data: 'x', rounding: 4 })).toEqual({ id: 'f', type: 'line', x: 5, y: 6, width: 100, height: 3 });
    expect(kept({ type: 'box', width: 50, height: 20, thickness: 4, rounding: 3, fill: false })).toEqual({ id: 'f', type: 'box', x: 5, y: 6, width: 50, height: 20, thickness: 4, rounding: 3, fill: false });
    expect(kept({ type: 'ellipse', width: 50, height: 20, thickness: 4, rounding: 3, fill: true })).toEqual({ id: 'f', type: 'ellipse', x: 5, y: 6, width: 50, height: 20, thickness: 4, fill: true });
  });
  it('checks a picture\'s bitmap against its size and bounds its text', () => {
    const img = { type: 'image', width: 10, height: 2, bitmap: 'qoDAwA==', dither: 'floyd', threshold: 0.4, source: 'data:image/png;base64,AAAA' };
    expect(kept(img)).toEqual({ id: 'f', x: 5, y: 6, ...img });
    expect(refused({ ...img, height: 3 })).toBe(true);
    expect(refused({ ...img, bitmap: '***=' })).toBe(true);
    expect(refused({ ...img, bitmap: undefined })).toBe(true);
    expect(refused({ ...img, width: 10.5 })).toBe(true);
    expect(refused({ ...img, source: 'https://example.test/a.png' })).toBe(true);
    expect(refused({ ...img, threshold: 2 })).toBe(true);
    expect(refused({ ...img, dither: 'jarvis' })).toBe(true);
    // 64 KB of base64 text is the most: 65536 characters are 49152 bytes, a 768 × 512 picture.
    const big = 'A'.repeat(MAX_IMAGE_TEXT);
    expect(cleanLabelLayout({ ...base, fields: [field({ type: 'image', width: 768, height: 512, bitmap: big })] }).ok).toBe(true);
    expect(refused({ type: 'image', width: 768, height: 512, bitmap: 'A'.repeat(MAX_IMAGE_TEXT + 4) })).toBe(true);
    expect(refused({ type: 'image', width: 8, height: 100, bitmap: big })).toBe(true);
    expect(refused({ ...img, source: `data:image/png;base64,${'A'.repeat(MAX_IMAGE_TEXT)}` })).toBe(true);
  });
  it('holds the pictures on a tag to a total the settings document can carry', () => {
    // 64000 characters are 48000 bytes: an 800 × 480 picture. Ten of them fit, eleven do not.
    const pic = (i: number) => ({ id: `p${i}`, type: 'image', x: 0, y: 0, width: 800, height: 480, bitmap: 'A'.repeat(64000) });
    expect(cleanLabelLayout({ ...base, fields: Array.from({ length: 10 }, (_, i) => pic(i)) }).ok).toBe(true);
    expect(cleanLabelLayout({ ...base, fields: Array.from({ length: 11 }, (_, i) => pic(i)) }).ok).toBe(false);
  });
  it('bounds every number, flag and word', () => {
    expect(refused({ type: 'text', data: 'A', width: 0 })).toBe(true);
    expect(refused({ type: 'text', data: 'A', lines: 1.5 })).toBe(true);
    expect(refused({ type: 'text', data: 'A', lines: 51 })).toBe(true);
    expect(refused({ type: 'text', data: 'A', lineSpacing: 501 })).toBe(true);
    expect(refused({ type: 'text', data: 'A', align: 'J' })).toBe(true);
    expect(refused({ type: 'text', data: 'A', bold: 'yes' })).toBe(true);
    expect(refused({ type: 'text', data: 'A', hidden: 1 })).toBe(true);
    expect(refused({ type: 'text', data: 'A', name: 'n'.repeat(101) })).toBe(true);
    expect(refused({ type: 'qr', data: 'A', errorCorrection: 'X' })).toBe(true);
    expect(refused({ type: 'barcode', data: 'A', symbology: 'qr' })).toBe(true);
    expect(refused({ type: 'barcode', data: 'A', height: 0 })).toBe(true);
    expect(refused({ type: 'barcode', data: 'A', moduleWidth: 11 })).toBe(true);
    expect(refused({ type: 'barcode', data: 'A', showText: 'Y' })).toBe(true);
    expect(refused({ type: 'box', width: 10 })).toBe(true);
    expect(refused({ type: 'box', width: 10, height: -1 })).toBe(true);
    expect(refused({ type: 'box', width: 10, height: 10, rounding: 9 })).toBe(true);
    expect(refused({ type: 'box', width: 10, height: 10, rounding: 1.5 })).toBe(true);
    expect(refused({ type: 'ellipse', width: 10, height: 10, thickness: -1 })).toBe(true);
    expect(refused({ type: 'line', width: 9000, height: 3 })).toBe(true);
    expect(refused({ type: 'qr', data: 'x'.repeat(501) })).toBe(true);
    expect(refused({ type: 'qr', data: 'x', y: Number.NaN })).toBe(true);
  });
  it('checks the layout\'s dpi, tags and printer options', () => {
    const printer = { thermal: 'direct', mode: 'peel', media: 'mark', darkness: 12, speed: 10, labelTop: -20, labelShift: 30, tearOff: 15, orientation: 'inverted', mirror: true, homeX: 4, homeY: 8, junk: 1 };
    const r = cleanLabelLayout({ ...base, dpi: 300, tags: 2, printer });
    expect(r).toEqual({ ok: true, layout: { ...base, dpi: 300, tags: 2, printer: { thermal: 'direct', mode: 'peel', media: 'mark', darkness: 12, speed: 10, labelTop: -20, labelShift: 30, tearOff: 15, orientation: 'inverted', mirror: true, homeX: 4, homeY: 8 } } });
    for (const bad of [{ dpi: 250 }, { dpi: '203' }, { tags: 0 }, { tags: 13 }, { tags: 1.5 }, { printer: 'x' }, { printer: [] }, { printer: { thermal: 'laser' } },
      { printer: { mode: 'chop' } }, { printer: { media: 'roll' } }, { printer: { darkness: 31 } }, { printer: { darkness: 1.5 } }, { printer: { speed: 1 } },
      { printer: { speed: 15 } }, { printer: { labelTop: 121 } }, { printer: { labelShift: 10000 } }, { printer: { tearOff: -121 } }, { printer: { orientation: 'sideways' } },
      { printer: { mirror: 'Y' } }, { printer: { homeX: -1 } }, { darkness: 40 }]) {
      expect(cleanLabelLayout({ ...base, ...bad }).ok).toBe(false);
    }
  });
  it('folds the older top-level darkness and speed into printer', () => {
    expect(cleanLabelLayout({ ...base, darkness: 10, speed: 5 })).toEqual({ ok: true, layout: { ...base, printer: { darkness: 10, speed: 5 } } });
    expect(cleanLabelLayout({ ...base, darkness: 10, printer: { darkness: 20 } })).toEqual({ ok: true, layout: { ...base, printer: { darkness: 20 } } });
    expect(cleanLabelLayout({ ...base, printer: {} })).toEqual({ ok: true, layout: base });
  });
  it('holds up to 200 fields', () => {
    const fields = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, type: 'box', x: 0, y: 0, width: 5, height: 5 }));
    expect(cleanLabelLayout({ ...base, fields: fields(200) }).ok).toBe(true);
    expect(cleanLabelLayout({ ...base, fields: fields(201) }).ok).toBe(false);
  });
});

describe('saveLabelLayout', () => {
  it('merges the layout into the shop\'s settings and logs it', async () => {
    const writes: unknown[][] = [];
    const logs: string[] = [];
    const db = { batch: () => ({ set: (...a: unknown[]) => writes.push(a), update() {}, delete() {}, commit: async () => undefined }) } as unknown as DbPort;
    await saveLabelLayout(db, STANDARD_LABEL_LAYOUT, { log: (a, t) => { logs.push(`${a} ${t}`); } });
    expect(writes).toEqual([['app_settings', 'global', { labelLayout: STANDARD_LABEL_LAYOUT }, true]]);
    expect(logs).toEqual(['settings.update Label layout saved']);
  });
});
