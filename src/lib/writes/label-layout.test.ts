import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DbPort } from '@/lib/db-port';
import { cleanLabelLayout, saveLabelLayout, STANDARD_LABEL_LAYOUT } from './label-layout';

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
      'x', [null], [{ ...field, type: 'barcode' }], [{ ...field, x: '1' }], [{ ...field, rotation: 45 }], [{ ...field, fontSize: 0 }],
      [{ ...field, data: 7 }], [field, field], [{ ...field, id: '' }], Array.from({ length: 51 }, (_, i) => ({ ...field, id: `f${i}` })),
    ]) {
      expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, fields }).ok).toBe(false);
    }
    expect(cleanLabelLayout(null).ok).toBe(false);
    expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, widthDots: 0 }).ok).toBe(false);
    expect(cleanLabelLayout({ ...STANDARD_LABEL_LAYOUT, id: '' }).ok).toBe(false);
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
