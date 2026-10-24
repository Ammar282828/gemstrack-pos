import { describe, expect, it } from 'vitest';
import type { LabelField, StoredLabelLayout } from '@/lib/label-layout';
import type { LabelValues } from '@/lib/label-live';
import { STANDARD_LABEL_LAYOUT } from '@/lib/writes/label-layout';
import { generateZplFromLayout } from '@/lib/zebra-printer';
import { escapeZpl, formatLabelDate, labelCount, renderZpl, resolveFields, resolveText } from '@/lib/zebra-zpl';

// Mirrored case for case by ERPCore's ZplTests.swift: the expected strings are the same.
const p1: LabelValues = {
  sku: 'TST-000001', name: 'Test Ring', price: 'Rs 12500', priceNumber: '12500', weight: '4.250 g', weightNumber: '4.250',
  'csv:sku': 'TST-000001', 'csv:product_name': 'Test Ring', 'csv:metal_weight_g': '4.250', 'csv:total_price_pkr': '12500',
};
const p2: LabelValues = {
  sku: 'TST-000002', name: 'Test Band', price: 'Rs 800', priceNumber: '800', weight: '1.5 g', weightNumber: '1.500',
  'csv:sku': 'TST-000002', 'csv:product_name': 'Test Band', 'csv:metal_weight_g': '1.500', 'csv:total_price_pkr': '800',
};
// 25 Oct 2026, 00:05:09 in Karachi (UTC+5), a Sunday.
const NOW = new Date(Date.UTC(2026, 9, 24, 19, 5, 9));
const layout = (fields: LabelField[], extra: Partial<StoredLabelLayout> = {}): StoredLabelLayout =>
  ({ id: 't', name: 'T', widthDots: 400, heightDots: 200, fields, ...extra });
const HEAD = '^XA^CI28^PW400^LL200^LS0\n';
const FOOT = '^PQ1,0,1,Y^XZ\n';
const text = (data: string, extra: Partial<LabelField> = {}): LabelField => ({ id: 'a', type: 'text', x: 10, y: 20, data, ...extra });
const one = (f: LabelField, extra: Partial<StoredLabelLayout> = {}, pieces: LabelValues[] = [p1]) => renderZpl(layout([f], extra), pieces, { now: NOW });

describe('placeholders', () => {
  it('fills piece fields and CSV columns, with _n for the nth piece of the label', () => {
    expect(resolveText('{sku} {name}', [p1])).toBe('TST-000001 Test Ring');
    expect(resolveText('{SKU_1}|{SKU_2}|{PRODUCT_NAME_2}|{METAL_WEIGHT_G_1}|{TOTAL_PRICE_PKR}', [p1, p2])).toBe('TST-000001|TST-000002|Test Band|4.250|12500');
    expect(resolveText('{sku_2} {csv_sku}', [p1, p2])).toBe('TST-000002 {csv_sku}');
  });
  it('prints a tag with no piece blank, and leaves a key that means nothing as typed', () => {
    expect(resolveText('[{SKU_2}][{name_2}][{TOTAL_PRICE_PKR_2}]', [p1])).toBe('[][][]');
    expect(resolveText('[{sku}]', [])).toBe('[]');
    expect(resolveText('{skux} {SKU_0} {} {a b} {sku', [p1])).toBe('{skux} {SKU_0} {} {a b} {sku');
    expect(resolveText('{{sku}} }{name}', [p1])).toBe('{TST-000001} }Test Ring');
  });
  it('formats {date} and {time} in Karachi time', () => {
    expect(resolveText('{date}', [], 0, NOW)).toBe('25 Oct 2026');
    expect(resolveText('{date:dd/MM/yy} {date:EEEE d MMMM yyyy}', [], 0, NOW)).toBe('25/10/26 Sunday 25 October 2026');
    expect(resolveText('{time} {time:h:mm a} {time:HH:mm:ss}', [], 0, NOW)).toBe('00:05 12:05 AM 00:05:09');
    expect(formatLabelDate("yyyy-MM-dd 'at' H 'o''clock' EEE", NOW)).toBe("2026-10-25 at 0 o'clock Sun");
    expect(formatLabelDate("hh h m s a", new Date(Date.UTC(2026, 0, 5, 9, 4, 3)))).toBe('02 2 4 3 PM');
  });
  it('numbers labels with {counter:START:STEP:PAD}', () => {
    expect(resolveText('{counter}', [], 0)).toBe('1');
    expect(resolveText('{counter}', [], 4)).toBe('5');
    expect(resolveText('{counter:100:5:6}', [], 3)).toBe('000115');
    expect(resolveText('{counter::2:3}', [], 2)).toBe('005');
    expect(resolveText('{counter:10:-3}', [], 5)).toBe('-5');
    expect(resolveText('{counter:1:1:4}', [], 2, NOW, 50)).toBe('0052');
  });
  it('transforms with a pipe', () => {
    expect(resolveText('{price|prefix:Rs |suffix:/-}', [p1])).toBe('Rs Rs 12500/-');
    expect(resolveText('{priceNumber|prefix:Rs |suffix:/-}', [p1])).toBe('Rs 12500/-');
    expect(resolveText('{name|upper} {name|lower}', [p1])).toBe('TEST RING test ring');
    expect(resolveText('{weight|fixed:2} {weightNumber|fixed:1} {weightNumber|fixed:0}', [p1])).toBe('4.25 4.3 4');
    expect(resolveText('{priceNumber|group} {price|group} {csv_x|group}', [p1])).toBe('12,500 Rs 12,500 {csv_x|group}');
    expect(resolveText('{name|max:4}|{name|max:0}|{name|max:99}', [p1])).toBe('Test||Test Ring');
    expect(resolveText('{name|upper|max:3|suffix:.}', [p1])).toBe('TES.');
    expect(resolveText('[{SKU_2|prefix:#}]', [p1])).toBe('[]');
    expect(resolveText('{name|nothing}', [p1])).toBe('Test Ring');
  });
  it('leaves other text, accents and braces alone', () => {
    expect(resolveText('Ring — 22k {sku}', [p1])).toBe('Ring — 22k TST-000001');
    expect(resolveText('{price|group}', [{ price: '1234567.50' }])).toBe('1,234,567.50');
  });
});

describe('escaping', () => {
  it('sends ^, ~ and \\ as hex under ^FH\\', () => {
    expect(escapeZpl('a^b~c\\d', '\\&')).toBe('a\\5Eb\\7Ec\\5Cd');
    expect(escapeZpl('a\nb', '\\&')).toBe('a\\&b');
    expect(escapeZpl('a\nb', '\\0A')).toBe('a\\0Ab');
    expect(one(text('50% ^off~ \\'))).toBe(`${HEAD}^FO10,20^A0N,20,20^FH\\^FD50% \\5Eoff\\7E \\5C^FS\n${FOOT}`);
  });
});

describe('renderZpl: text', () => {
  it('draws the standard tag', () => {
    expect(renderZpl(STANDARD_LABEL_LAYOUT, [p1], { now: NOW })).toBe(
      '^XA^CI28^PW664^LL296^LS0\n^FO100,150^A0R,20,20^FH\\^FDSKU: TST-000001^FS\n^FO450,80^BQN,2,4,M^FH\\^FDMA,TST-000001^FS\n^PQ1,0,1,Y^XZ\n');
  });
  it('picks the font, size, orientation', () => {
    expect(one(text('Hi', { fontFamily: 'D', fontSize: 30, rotation: 180 }))).toBe(`${HEAD}^FO10,20^ADI,30,30^FH\\^FDHi^FS\n${FOOT}`);
    expect(one(text('Hi', { rotation: 270 }))).toBe(`${HEAD}^FO10,20^A0B,20,20^FH\\^FDHi^FS\n${FOOT}`);
  });
  it('wraps in a block with a width', () => {
    expect(one(text('a\nb', { width: 120, align: 'C' }))).toBe(`${HEAD}^FO10,20^A0N,20,20^FB120,2,0,C^FH\\^FDa\\&b^FS\n${FOOT}`);
    expect(one(text('a', { width: 120, lines: 3, lineSpacing: -4, align: 'R' }))).toBe(`${HEAD}^FO10,20^A0N,20,20^FB120,3,-4,R^FH\\^FDa^FS\n${FOOT}`);
  });
  it('gives each line its own field without a width, and turns the stack with the text', () => {
    const f = (rotation: 0 | 90 | 180 | 270) => one(text('a\nb\nc', { x: 100, y: 100, fontSize: 20, lineSpacing: 2, rotation }));
    expect(f(0)).toBe(`${HEAD}^FO100,100^A0N,20,20^FH\\^FDa^FS\n^FO100,122^A0N,20,20^FH\\^FDb^FS\n^FO100,144^A0N,20,20^FH\\^FDc^FS\n${FOOT}`);
    expect(f(90)).toBe(`${HEAD}^FO144,100^A0R,20,20^FH\\^FDa^FS\n^FO122,100^A0R,20,20^FH\\^FDb^FS\n^FO100,100^A0R,20,20^FH\\^FDc^FS\n${FOOT}`);
    expect(f(180)).toBe(`${HEAD}^FO100,144^A0I,20,20^FH\\^FDa^FS\n^FO100,122^A0I,20,20^FH\\^FDb^FS\n^FO100,100^A0I,20,20^FH\\^FDc^FS\n${FOOT}`);
    expect(f(270)).toBe(`${HEAD}^FO100,100^A0B,20,20^FH\\^FDa^FS\n^FO122,100^A0B,20,20^FH\\^FDb^FS\n^FO144,100^A0B,20,20^FH\\^FDc^FS\n${FOOT}`);
  });
  it('draws bold text twice, a dot apart', () => {
    expect(one(text('B', { bold: true }))).toBe(`${HEAD}^FO10,20^A0N,20,20^FH\\^FDB^FS\n^FO11,20^A0N,20,20^FH\\^FDB^FS\n${FOOT}`);
  });
  it('rounds and bounds positions, and defaults the size', () => {
    expect(one(text('x', { x: 10.5, y: -3, fontSize: 0 }))).toBe(`${HEAD}^FO11,0^A0N,20,20^FH\\^FDx^FS\n${FOOT}`);
    expect(one(text('x', { x: 99999, y: 0.4, fontSize: 12.6 }))).toBe(`${HEAD}^FO32000,0^A0N,13,13^FH\\^FDx^FS\n${FOOT}`);
  });
  it('fills the placeholders of each piece into one label', () => {
    expect(renderZpl(layout([text('{SKU_1}/{SKU_2}', { width: 50 })], { tags: 2 }), [p1, p2], { now: NOW })).toBe(
      `${HEAD}^FO10,20^A0N,20,20^FB50,1,0,L^FH\\^FDTST-000001/TST-000002^FS\n${FOOT}`);
  });
});

describe('renderZpl: codes', () => {
  const qr = (extra: Partial<LabelField> = {}): LabelField => ({ id: 'q', type: 'qr', x: 5, y: 6, data: '{sku}', ...extra });
  it('draws a QR code', () => {
    expect(one(qr())).toBe(`${HEAD}^FO5,6^BQN,2,2,M^FH\\^FDMA,TST-000001^FS\n${FOOT}`);
    expect(one(qr({ qrMagnification: 7, errorCorrection: 'H', rotation: 90 }))).toBe(`${HEAD}^FO5,6^BQR,2,7,H^FH\\^FDHA,TST-000001^FS\n${FOOT}`);
    expect(one(qr({ qrMagnification: 40 }))).toBe(`${HEAD}^FO5,6^BQN,2,10,M^FH\\^FDMA,TST-000001^FS\n${FOOT}`);
    expect(one(qr({ data: 'a^b' }))).toBe(`${HEAD}^FO5,6^BQN,2,2,M^FH\\^FDMA,a\\5Eb^FS\n${FOOT}`);
  });
  it('draws nothing for a code with no data', () => {
    expect(one(qr({ data: '{SKU_2}' }))).toBe(HEAD + FOOT);
    expect(one({ id: 'b', type: 'barcode', x: 1, y: 1, data: '' })).toBe(HEAD + FOOT);
  });
  it('draws each barcode kind', () => {
    const bc = (extra: Partial<LabelField>): string => one({ id: 'b', type: 'barcode', x: 8, y: 9, data: '{sku}', ...extra });
    expect(bc({})).toBe(`${HEAD}^FO8,9^BY2^BCN,40,N,N,N^FH\\^FDTST-000001^FS\n${FOOT}`);
    expect(bc({ height: 60, moduleWidth: 3, showText: true, rotation: 90 })).toBe(`${HEAD}^FO8,9^BY3^BCR,60,Y,N,N^FH\\^FDTST-000001^FS\n${FOOT}`);
    expect(bc({ symbology: 'code39' })).toBe(`${HEAD}^FO8,9^BY2^B3N,N,40,N,N^FH\\^FDTST-000001^FS\n${FOOT}`);
    expect(bc({ symbology: 'ean13', data: '5901234123457', showText: true })).toBe(`${HEAD}^FO8,9^BY2^BEN,40,Y,N^FH\\^FD5901234123457^FS\n${FOOT}`);
    expect(bc({ symbology: 'upca', data: '036000291452' })).toBe(`${HEAD}^FO8,9^BY2^BUN,40,N,N,Y^FH\\^FD036000291452^FS\n${FOOT}`);
    expect(bc({ symbology: 'datamatrix', moduleWidth: 4 })).toBe(`${HEAD}^FO8,9^BXN,4,200^FH\\^FDTST-000001^FS\n${FOOT}`);
    expect(bc({ symbology: 'pdf417', height: 80, moduleWidth: 12 })).toBe(`${HEAD}^FO8,9^BY10^B7N,80^FH\\^FDTST-000001^FS\n${FOOT}`);
  });
});

describe('renderZpl: shapes and pictures', () => {
  it('draws lines, boxes and ellipses', () => {
    const s = (extra: Partial<LabelField>): string => one({ id: 's', type: 'box', x: 4, y: 5, width: 100, height: 30, ...extra });
    expect(s({ type: 'line', height: 3 })).toBe(`${HEAD}^FO4,5^GB100,3,3,B,0^FS\n${FOOT}`);
    expect(s({ type: 'line', width: 2, height: 80, rounding: 5 })).toBe(`${HEAD}^FO4,5^GB2,80,2,B,0^FS\n${FOOT}`);
    expect(s({})).toBe(`${HEAD}^FO4,5^GB100,30,2,B,0^FS\n${FOOT}`);
    expect(s({ thickness: 6, rounding: 4 })).toBe(`${HEAD}^FO4,5^GB100,30,6,B,4^FS\n${FOOT}`);
    expect(s({ fill: true, rounding: 99 })).toBe(`${HEAD}^FO4,5^GB100,30,30,B,8^FS\n${FOOT}`);
    expect(s({ type: 'ellipse' })).toBe(`${HEAD}^FO4,5^GE100,30,2,B^FS\n${FOOT}`);
    expect(s({ type: 'ellipse', fill: true })).toBe(`${HEAD}^FO4,5^GE100,30,30,B^FS\n${FOOT}`);
  });
  it('prints a picture as ^GFA hex, turned for 180 and still for 90', () => {
    // 10 × 2 dots: 2 bytes a row. Row 1: 1010101010, row 2: 1100000011.
    const bitmap = 'qoDAwA=='; // AA 80 C0 C0
    const img = (extra: Partial<LabelField> = {}): string => one({ id: 'i', type: 'image', x: 3, y: 4, width: 10, height: 2, bitmap, ...extra });
    expect(img()).toBe(`${HEAD}^FO3,4^GFA,4,4,2,AA80C0C0^FS\n${FOOT}`);
    // Half a turn: row 2 first, each row reversed over its 10 dots: 1100000011 → 1100000011, 1010101010 → 0101010101.
    expect(img({ rotation: 180 })).toBe(`${HEAD}^FO3,4^GFA,4,4,2,C0C05540^FS\n${FOOT}`);
    expect(img({ rotation: 90 })).toBe(`${HEAD}^FO3,4^GFA,4,4,2,AA80C0C0^FS\n${FOOT}`);
    expect(img({ bitmap: '!!' })).toBe(HEAD + FOOT);
    expect(img({ bitmap: undefined })).toBe(HEAD + FOOT);
    // Too short a bitmap is padded with white.
    expect(img({ bitmap: 'qg==' })).toBe(`${HEAD}^FO3,4^GFA,4,4,2,AA000000^FS\n${FOOT}`);
  });
});

describe('renderZpl: the printer and the job', () => {
  it('sends the printer options once a label, in a fixed order', () => {
    const printer = {
      mirror: true, orientation: 'inverted', tearOff: -5, darkness: 7, speed: 4, media: 'mark', mode: 'peel', thermal: 'direct',
      labelShift: -12, labelTop: 30, homeX: 8, homeY: 16,
    } as const;
    expect(renderZpl(layout([], { printer }), [p1], { now: NOW })).toBe(
      '^XA^CI28^PW400^LL200^LH8,16^LT30^LS-12^MTD^MMP^MNM^PR4~SD07~TA-005^POI^PMY\n^PQ1,0,1,Y^XZ\n');
    expect(renderZpl(layout([], { printer: { thermal: 'transfer', mode: 'delayed-cut', media: 'gap', tearOff: 12, orientation: 'normal', mirror: false } }), [p1])).toBe(
      '^XA^CI28^PW400^LL200^LS0^MTT^MMD^MNY~TA+012^PON^PMN\n^PQ1,0,1,Y^XZ\n');
    expect(renderZpl(layout([], { printer: { mode: 'cutter', media: 'continuous', darkness: 99, speed: 99, labelTop: -500, tearOff: 0 } }), [p1])).toBe(
      '^XA^CI28^PW400^LL200^LT-120^LS0^MMC^MNN^PR14~SD30~TA+000\n^PQ1,0,1,Y^XZ\n');
  });
  it('still reads the darkness and speed older layouts kept at the top', () => {
    expect(renderZpl(layout([], { darkness: 12, speed: 3 }), [p1])).toBe('^XA^CI28^PW400^LL200^LS0^PR3~SD12\n^PQ1,0,1,Y^XZ\n');
    expect(renderZpl(layout([], { darkness: 12, speed: 3, printer: { darkness: 20 } }), [p1])).toBe('^XA^CI28^PW400^LL200^LS0^PR3~SD20\n^PQ1,0,1,Y^XZ\n');
  });
  it('makes one label to the tags a layout holds, with copies, skip and a counter', () => {
    const l = layout([text('{SKU_1} {SKU_2} #{counter:7:1:3}', { x: 1, y: 2 })], { tags: 2 });
    const z = renderZpl(l, [p1, p2, p1], { copies: 3, skip: 1, now: NOW });
    expect(z).toBe(
      `${HEAD}^PQ1,0,1,Y^XZ\n` +
      `${HEAD}^FO1,2^A0N,20,20^FH\\^FDTST-000001 TST-000002 #007^FS\n^PQ3,0,1,Y^XZ\n` +
      `${HEAD}^FO1,2^A0N,20,20^FH\\^FDTST-000001  #008^FS\n^PQ3,0,1,Y^XZ\n`);
    expect(renderZpl(l, [p1, p2, p1], { counterStart: 90, now: NOW })).toContain('#090^FS');
    expect(renderZpl(l, [], { skip: 0 })).toBe('');
    expect(renderZpl(l, [p1], { copies: 0 })).toContain('^PQ1,0,1,Y');
  });
  it('counts labels', () => {
    expect(labelCount([p1, p2, p1], layout([]))).toBe(3);
    expect(labelCount([p1, p2, p1], layout([], { tags: 2 }))).toBe(2);
    expect(labelCount(4, layout([], { tags: 2 }))).toBe(2);
    expect(labelCount([], layout([], { tags: 2 }))).toBe(0);
  });
  it('skips hidden fields on print but keeps them for the designer', () => {
    const l = layout([text('A'), { ...text('B'), id: 'b', hidden: true, locked: true, name: 'Hidden' }]);
    expect(renderZpl(l, [p1])).toBe(`${HEAD}^FO10,20^A0N,20,20^FH\\^FDA^FS\n${FOOT}`);
    const r = resolveFields(l, [p1]);
    expect(r.map((f) => [f.id, f.hidden])).toEqual([['a', undefined], ['b', true]]);
  });
});

describe('resolveFields', () => {
  it('works the data of text, QR and barcode fields out for one label of a job', () => {
    const l = layout([
      text('{SKU_2} {counter::10:2}'), { id: 'q', type: 'qr', x: 0, y: 0, data: '{SKU_1}' },
      { id: 'b', type: 'barcode', x: 0, y: 0, data: '{date}' }, { id: 'x', type: 'box', x: 0, y: 0, width: 5, height: 5 },
    ], { tags: 2 });
    const r = resolveFields(l, [p1, p2], 3, NOW);
    expect(r.map((f) => f.data)).toEqual(['TST-000002 31', 'TST-000001', '25 Oct 2026', undefined]);
    expect(l.fields[0].data).toBe('{SKU_2} {counter::10:2}');
  });
});

describe('generateZplFromLayout (the older entry point)', () => {
  it('prints the older layout through the new renderer', () => {
    const zpl = generateZplFromLayout({
      id: 'x', name: 'x', widthDots: 664, heightDots: 296,
      fields: [
        { id: 'a', type: 'text', x: 10, y: 20, data: 'SKU: {sku}', fontSize: 30, rotation: 90, width: 200, textAlign: 'C' },
        { id: 'b', type: 'qr', x: 300, y: 50, data: '{sku}', qrMagnification: 4 },
      ],
    }, { sku: 'TST-000009', extra: 5 });
    expect(zpl).toBe(
      '^XA^CI28^PW664^LL296^LS0\n^FO10,20^A0R,30,30^FB200,1,0,C^FH\\^FDSKU: TST-000009^FS\n^FO300,50^BQN,2,4,M^FH\\^FDMA,TST-000009^FS\n^PQ1,0,1,Y^XZ\n');
  });
});
