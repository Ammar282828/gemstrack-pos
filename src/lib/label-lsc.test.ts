import { describe, expect, it } from 'vitest';
import { bitmapHex } from '@/lib/label-bitmap';
import { importLsc } from '@/lib/label-lsc';
import { cleanLabelLayout } from '@/lib/writes/label-layout';
import { renderZpl } from '@/lib/zebra-zpl';
import { PNG_8X2 } from '@/lib/test-fixtures/label-png';

// A made-up design in Label LIVE's file shape (a 50 × 25 mm double tag at 203 dpi), mirrored by ERPCore's LabelLSCTests.swift.
const PNG = `data:image/png;base64,${PNG_8X2}`;
const el = (type: string, config: object, extra: object = {}) => ({ id: 'x', type, config, hideOnPrint: false, ...extra });
const fo = (type: string, extra: object) => ({ type, left: 0, top: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, angle: 0, originX: 'left', originY: 'top', ...extra });
const OBJECTS: [object, object][] = [
  [el('ELEMENT_TEXT', { text: '{SKU_1}\n{PRODUCT_NAME_1}' }),
    fo('textbox', { left: -150, top: -60, width: 100, height: 60, fontSize: 20, lineHeight: 1, textAlign: 'center' })],
  [el('ELEMENT_TEXT', { text: '{SKU_2}' }),
    fo('textbox', { left: 150, top: -80, width: 60, height: 30, fontSize: 10, lineHeight: 1.2, angle: 90 })],
  [el('ELEMENT_BARCODE', { bcid: 'qrcode', scale: 3, opts: { eclevel: 'Q' }, rotate: 'I', text: '{STALE}' }),
    fo('image', { left: -100, top: 50, width: 126, height: 126, scaleX: 0.5, scaleY: 0.5, originX: 'center', originY: 'center' })],
  [el('ELEMENT_BARCODE', { bcid: 'code128', scale: 2, rotate: 'N', text: '{SKU_2}', opts: { includetext: true } }),
    fo('image', { left: 0, top: 70, width: 200, height: 80, originX: 'center', originY: 'center' })],
  [el('ELEMENT_IMAGE', { kindId: 'DITHER_KIND_THRESHOLD' }),
    fo('image', { left: 100, top: 60, width: 8, height: 2, scaleX: 4, scaleY: 4, originX: 'center', originY: 'center', src: PNG })],
  [el('ELEMENT_IMAGE', { kindId: 'DITHER_KIND_ATKINSON' }),
    fo('image', { left: -120, top: 60, width: 8, height: 2, scaleX: 2, scaleY: 2, angle: 90, originX: 'center', originY: 'center', src: PNG })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 3 }),
    fo('line', { left: 0, top: -90, width: 100, height: 0, originX: 'center', originY: 'center', stroke: '#000000' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#FEFFFF', strokeWidth: 3 }),
    fo('line', { left: 0, top: 0, width: 200, height: 0, originX: 'center', originY: 'center', stroke: '#FEFFFF' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 2 }),
    fo('line', { left: 180, top: 0, width: 0, height: 60, originX: 'center', originY: 'center', stroke: '#000000' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 2 }),
    fo('line', { left: 0, top: 0, width: 50, height: 50, stroke: '#000000' })],
  [el('ELEMENT_SHAPE_RECT', { fill: null, stroke: '#000000', strokeWidth: 4 }),
    fo('rect', { left: -190, top: -95, width: 60, height: 30, rx: 15 })],
  [el('ELEMENT_SHAPE_RECT', { fill: '#000000', stroke: null, strokeWidth: 0 }, { hideOnPrint: true }),
    fo('rect', { left: -190, top: 60, width: 30, height: 30 })],
  [el('ELEMENT_SHAPE_ELLIPSE', { fill: null, stroke: '#000000', strokeWidth: 2 }),
    fo('ellipse', { left: 100, top: 70, width: 40, height: 20, rx: 20, ry: 10 })],
  [el('ELEMENT_SPARKLE', {}), fo('group', {})],
  [el('ELEMENT_IMAGE', {}), fo('image', { src: 'data:image/jpeg;base64,/9j/4AAQ' })],
];
const design = (extra: object = {}): string => JSON.stringify({
  version: '4.3.3',
  path: '/Users/someone/designs/private.lsc',
  labelConfig: {
    widthMeasure: '50', heightMeasure: '25', dpi: 203, metric: true,
    printerConfig: { DARKNESS: '18', SPEED: '4', THERMAL_MODE: 'THERMAL_MODE_DIRECT', MOCK_TARGET_PRINTER: 'PRIVATE-PRINTER-NAME' },
  },
  canvasRecord: {
    fill: '#FEFFFF',
    objects: OBJECTS.map(([o]) => o),
    fabricRep: { version: '5.3.0', objects: OBJECTS.map(([, f]) => f) },
    variables: [{ name: 'SKU_1', value: 'SECRET-SAMPLE' }, { name: 'SKU_2', value: 'SECRET-SAMPLE' }, { name: 'PRODUCT_NAME_1', value: 'SECRET-SAMPLE' }],
  },
  ui: { windowName: 'SECRET-WINDOW' },
  dataImport: { data: [{ SKU_1: 'SECRET-SAMPLE' }] },
  ...extra,
});

describe('importLsc', () => {
  const layout = importLsc(design())!;
  const byId = (n: number) => layout.fields.find((f) => f.id === `lsc-${n}`);

  it('takes the label size, dpi, tags and printer settings', () => {
    expect([layout.widthDots, layout.heightDots, layout.dpi, layout.tags]).toEqual([400, 200, 203, 2]);
    expect(layout.printer).toEqual({ thermal: 'direct', darkness: 18, speed: 4 });
    expect([layout.id, layout.name]).toEqual(['lsc-import', 'Imported design']);
    const named = importLsc(design(), { id: 'mine', name: 'My tag' })!;
    expect([named.id, named.name]).toEqual(['mine', 'My tag']);
  });
  it('reads a size in inches', () => {
    const inch = importLsc(design({ labelConfig: { widthMeasure: '2', heightMeasure: '1', dpi: 300, metric: false } }))!;
    expect([inch.widthDots, inch.heightDots, inch.dpi, inch.printer]).toEqual([600, 300, 300, undefined]);
  });
  it('turns a text box into a text field at its corner, size, lines and spacing', () => {
    expect(byId(1)).toEqual({ id: 'lsc-1', type: 'text', name: 'Text', x: 50, y: 40, data: '{SKU_1}\n{PRODUCT_NAME_1}', fontSize: 20, width: 100, lines: 2, lineSpacing: 3, align: 'C' });
  });
  it('puts a turned text box at the corner of its turned box', () => {
    expect(byId(2)).toEqual({ id: 'lsc-2', type: 'text', name: 'Text', x: 320, y: 20, data: '{SKU_2}', fontSize: 10, width: 60, lines: 1, lineSpacing: 4, rotation: 90 });
  });
  it('turns a QR image into a QR field and gives a stale sample the nearest tag\'s SKU', () => {
    expect(byId(3)).toEqual({ id: 'lsc-3', type: 'qr', name: 'QR code', x: 69, y: 119, data: '{SKU_1}', qrMagnification: 3, errorCorrection: 'Q', rotation: 180 });
  });
  it('turns another barcode into a barcode field, keeping a variable of the design', () => {
    expect(byId(4)).toEqual({ id: 'lsc-4', type: 'barcode', name: 'Barcode', x: 100, y: 130, data: '{SKU_2}', symbology: 'code128', height: 80, moduleWidth: 2, showText: true });
  });
  it('makes a picture a bitmap at the size it is drawn, keeping its source', () => {
    const a = byId(5)!;
    expect([a.type, a.x, a.y, a.width, a.height, a.dither, a.rotation, a.source]).toEqual(['image', 284, 156, 32, 8, 'threshold', undefined, PNG]);
    // Each of the file's 8 × 2 pixels is a 4 × 4 block: the file's row 1 (1 0 0 1 0 1 1 0) is F0 0F 0F F0 and row 2 (0 1 1 0 0 1 0 1) is 0F F0 0F 0F, four dots high each.
    expect(renderZpl({ ...layout, fields: [a], tags: 1 }, [{}]).split('\n')[1]).toBe(`^FO284,156^GFA,32,32,4,${'F00F0FF0'.repeat(4)}${'0FF00F0F'.repeat(4)}^FS`);
  });
  it('turns a quarter-turned picture\'s bits and sets it upright', () => {
    const b = byId(6)!;
    expect([b.x, b.y, b.width, b.height, b.dither, b.rotation]).toEqual([78, 152, 4, 16, 'atkinson', undefined]);
    // 16 × 4 dithered (Atkinson), then a quarter turn clockwise.
    expect(bitmapHex(b.bitmap!, 4, 16, false)!.hex).toBe('3030C0C0C0C010300000F0703030C0C0');
  });
  it('turns black lines into bars, leaves out a line in the label\'s own colour and a slanted one', () => {
    expect(byId(7)).toEqual({ id: 'lsc-7', type: 'line', name: 'Line', x: 150, y: 9, width: 100, height: 3 });
    expect(byId(8)).toBeUndefined();
    expect(byId(9)).toEqual({ id: 'lsc-9', type: 'line', name: 'Line', x: 379, y: 70, width: 2, height: 60 });
    expect(byId(10)).toBeUndefined();
  });
  it('turns rectangles and ellipses into boxes and ellipses; a hidden one stays hidden', () => {
    expect(byId(11)).toEqual({ id: 'lsc-11', type: 'box', name: 'Box', x: 10, y: 5, width: 60, height: 30, thickness: 4, rounding: 8 });
    expect(byId(12)).toEqual({ id: 'lsc-12', type: 'box', name: 'Box', x: 10, y: 160, width: 30, height: 30, fill: true, hidden: true });
    expect(byId(13)).toEqual({ id: 'lsc-13', type: 'ellipse', name: 'Ellipse', x: 300, y: 170, width: 40, height: 20, thickness: 2 });
  });
  it('leaves out what it does not know and a picture it cannot decode, and can be given a decoder', () => {
    expect(layout.fields.map((f) => f.id)).toEqual(['lsc-1', 'lsc-2', 'lsc-3', 'lsc-4', 'lsc-5', 'lsc-6', 'lsc-7', 'lsc-9', 'lsc-11', 'lsc-12', 'lsc-13']);
    const withDecoder = importLsc(design(), { decodeImage: (url) => (url.startsWith('data:image/jpeg') ? { width: 1, height: 1, rgba: Uint8Array.from([0, 0, 0, 255]) } : null) })!;
    const last = withDecoder.fields[withDecoder.fields.length - 1];
    expect([withDecoder.fields.length, last.type, last.width, last.height]).toEqual([12, 'image', 10, 10]);
  });
  it('never carries a value, a path or the window', () => {
    const json = JSON.stringify(layout);
    for (const secret of ['SECRET-SAMPLE', 'SECRET-WINDOW', 'PRIVATE-PRINTER-NAME', '/Users/someone', 'private.lsc']) expect(json).not.toContain(secret);
  });
  it('gives a layout the save accepts and prints', () => {
    expect(cleanLabelLayout(layout)).toEqual({ ok: true, layout });
    const zpl = renderZpl(layout, [{ 'csv:sku': 'TST-000001', 'csv:product_name': 'Test Ring' }, { 'csv:sku': 'TST-000002' }], { now: new Date(0) });
    expect(zpl.startsWith('^XA^CI28^PW400^LL200^LS0^MTD^PR4~SD18\n')).toBe(true);
    expect(zpl).toContain('^FO50,40^A0N,20,20^FB100,2,3,C^FH_^FDTST-000001\\&Test Ring^FS\n');
    expect(zpl).toContain('^FO320,20^A0R,10,10^FB60,1,4,L^FH_^FDTST-000002^FS\n');
    expect(zpl).not.toContain('{');
  });
  it('gives null for what is not a design', () => {
    expect(importLsc('not json')).toBeNull();
    expect(importLsc('[]')).toBeNull();
    expect(importLsc({ labelConfig: {} })).toBeNull();
    expect(importLsc(null)).toBeNull();
  });
  it('keeps one tag when the variables are not numbered', () => {
    const plain = JSON.parse(design());
    plain.canvasRecord.variables = [{ name: 'SKU', value: '' }, { name: 'PRICE_2', value: '' }];
    expect(importLsc(plain)!.tags).toBeUndefined();
    // …and a stale QR sample then takes the plain {sku}.
    expect(importLsc(plain)!.fields.find((f) => f.id === 'lsc-3')!.data).toBe('{sku}');
  });
});
