// The golden cases the apps hold their tag engines to: what this file's TypeScript (zebra-zpl.ts, label-lsc.ts,
// label-bitmap.ts) prints for a fixed set of made-up layouts, pieces and moments. `label-golden.test.ts` writes them to
// apps/android/core/src/test/resources/label-golden.json (WRITE_LABEL_GOLDEN=1) and fails when the committed file is not
// what this code prints today; Android's core tests (LabelGoldenTests) read the same file and must print the same ZPL, byte
// for byte, import the same layout from the same .lsc, and make the same bitmaps. All values are invented.

import { base64Encode, rasterToBitmap } from '@/lib/label-bitmap';
import { importLsc } from '@/lib/label-lsc';
import type { LabelField, LabelPrinterSettings, StoredLabelLayout } from '@/lib/label-layout';
import type { LabelValues } from '@/lib/label-live';
import { decodePngDataUrl } from '@/lib/png-decode';
import { PNG_24X20, PNG_8X2 } from '@/lib/test-fixtures/label-png';
import { STANDARD_LABEL_LAYOUT } from '@/lib/writes/label-layout';
import { formatLabelDate, renderZpl, resolveText } from '@/lib/zebra-zpl';

const piece = (n: number, name: string, extra: LabelValues = {}): LabelValues => ({
  sku: `TST-00000${n}`, name, price: `Rs ${n * 4200}`, priceNumber: String(n * 4200), weight: `${n}.250 g`, weightNumber: `${n}.250`,
  metal: 'Gold 21k', karat: '21k', category: 'Rings', stones: 'Two small, pink', stoneWeight: '0.400', diamonds: '', size: '7', plating: '', shop: 'Demo, Jewellers',
  qr: `TST-00000${n}`, date: '25 Oct 2026',
  'csv:sku': `TST-00000${n}`, 'csv:product_name': name, 'csv:category_id': 'cat001', 'csv:shop_name': 'Demo, Jewellers',
  'csv:total_price_pkr': String(n * 4200), 'csv:metal_type': 'gold', 'csv:metal_weight_g': `${n}.250`, 'csv:karat': '21k', 'csv:qr_content': `TST-00000${n}`,
  ...extra,
});

const PIECES: LabelValues[] = [
  piece(1, 'Rose ring'),
  piece(2, 'Band — 22k "bold" ^~\\_ é ₨ 💎'),
  piece(3, 'Line one\nLine two'),
];

// 25 Oct 2026, 00:05:09 in Karachi (UTC+5), a Sunday; and a day in the afternoon.
const NOW_MS = Date.UTC(2026, 9, 24, 19, 5, 9);
const AFTERNOON_MS = Date.UTC(2026, 11, 31, 18, 59, 59);

const BITMAP_10X2 = 'qoDAwA==';

const layout = (fields: LabelField[], extra: Partial<StoredLabelLayout> = {}): StoredLabelLayout =>
  ({ id: 't', name: 'T', widthDots: 400, heightDots: 200, fields, ...extra });
const f = (type: LabelField['type'], extra: Partial<LabelField>): LabelField => ({ id: `${type}-1`, type, x: 12, y: 34, ...extra });

export interface ZplCase {
  name: string;
  layout: unknown;
  /** Indices into the file's `pieces`. */
  pieces: number[];
  copies?: number;
  skip?: number;
  counterStart?: number;
  nowMs: number;
  zpl: string;
}

export interface ResolveCase { template: string; pieces: number[]; labelIndex: number; counterStart?: number; nowMs: number; text: string }
export interface DateCase { pattern: string; atMs: number; text: string }
export interface LscCase { name: string; lsc: string; layout: unknown; zpl: string }
export interface BitmapCase { name: string; png: string; width: number; height: number; dither?: string; threshold?: number; brightness?: number; bitmap: string }

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function zplCases(): ZplCase[] {
  const out: ZplCase[] = [];
  const add = (name: string, l: StoredLabelLayout, pieces: LabelValues[], opts: { copies?: number; skip?: number; counterStart?: number; nowMs?: number } = {}) => {
    const nowMs = opts.nowMs ?? NOW_MS;
    const zpl = renderZpl(l, pieces, { copies: opts.copies, skip: opts.skip, counterStart: opts.counterStart, now: new Date(nowMs) });
    out.push({ name, layout: json(l), pieces: pieces.map((p) => PIECES.indexOf(p)), copies: opts.copies, skip: opts.skip, counterStart: opts.counterStart, nowMs, zpl });
  };

  add('standard tag, one piece', STANDARD_LABEL_LAYOUT, [PIECES[0]]);
  add('standard tag, three pieces, copies and skip', STANDARD_LABEL_LAYOUT, PIECES, { copies: 4, skip: 2 });

  // Every field type, every turn.
  for (const rotation of [0, 90, 180, 270] as const) {
    add(`text at ${rotation}`, layout([f('text', { rotation, data: '{name}\n{price|prefix:Rs |group}', fontSize: 26, lineSpacing: 3 })]), [PIECES[1]]);
    add(`text block at ${rotation}`, layout([f('text', { rotation, data: '{SKU_1}\n{name_2}', width: 180, lines: 3, lineSpacing: -2, align: 'R', fontFamily: 'D', bold: true })], { tags: 2 }), PIECES);
    add(`qr at ${rotation}`, layout([f('qr', { rotation, data: '{sku}', qrMagnification: 5, errorCorrection: 'Q' })]), [PIECES[0]]);
    for (const symbology of ['code128', 'code39', 'ean13', 'upca', 'datamatrix', 'pdf417', undefined] as const) {
      add(`barcode ${symbology ?? 'default'} at ${rotation}`, layout([f('barcode', { rotation, data: '{sku}', symbology, height: 55, moduleWidth: 3, showText: rotation % 180 === 0 })]), [PIECES[0]]);
    }
    add(`image at ${rotation}`, layout([f('image', { rotation, width: 10, height: 2, bitmap: BITMAP_10X2 })]), [PIECES[0]]);
    add(`box at ${rotation}`, layout([f('box', { rotation, width: 90, height: 40, thickness: 5, rounding: 3 }), f('ellipse', { rotation, width: 60, height: 30, fill: true }), f('line', { rotation, width: 80, height: 3 })]), [PIECES[0]]);
  }
  for (const [n, extra] of [
    ['qr default', {}],
    ['qr low', { errorCorrection: 'L', qrMagnification: 0 }],
    ['qr huge', { errorCorrection: 'H', qrMagnification: 99 }],
  ] as [string, Partial<LabelField>][]) add(n, layout([f('qr', { data: '{sku_2}|{date}', ...extra })]), PIECES);
  add('image too short, odd and missing', layout([
    f('image', { id: 'a', width: 10, height: 2, bitmap: 'qg==' }), f('image', { id: 'b', width: 3, height: 3, bitmap: '!!' }),
    f('image', { id: 'c', width: 3, height: 3 }), f('image', { id: 'd', width: 12, height: 3, bitmap: base64Encode([255, 0, 170, 85, 1, 2, 3, 4, 5, 6]) }),
  ]), [PIECES[0]]);
  add('shapes: thickness, rounding, fill', layout([
    f('box', { id: '1', width: 100, height: 30 }), f('box', { id: '2', width: 100, height: 30, thickness: 9, rounding: 20 }),
    f('box', { id: '3', width: 20, height: 30, fill: true, rounding: 4 }), f('ellipse', { id: '4', width: 100, height: 30 }),
    f('ellipse', { id: '5', width: 10, height: 30, thickness: 4 }), f('line', { id: '6', width: 100, height: 2 }), f('line', { id: '7', width: 0, height: 0 }),
  ]), [PIECES[0]]);

  // Text: escapes, accents, wrapping, no width stacks, hidden, rounding and clamping of positions.
  add('text with the characters ZPL reads', layout([f('text', { data: '50% ^off~ \\ _under\nnext _5E {name_2}' })]), PIECES);
  add('text unicode', layout([f('text', { data: 'éè ₨ 💎   مرحبا {sku}', fontSize: 31 })]), [PIECES[0]]);
  add('positions rounded and held', layout([
    f('text', { id: 'a', x: 10.5, y: -3, fontSize: 0, data: 'x' }), f('text', { id: 'b', x: 99999, y: 0.4, fontSize: 12.6, data: 'y' }),
    f('text', { id: 'c', x: 1.49, y: 2.5, fontSize: 19.5, data: 'z', lineSpacing: 99999, width: 1.2 }),
  ]), [PIECES[0]]);
  add('hidden fields stay off the label', layout([f('text', { id: 'a', data: 'A' }), f('text', { id: 'b', data: 'B', hidden: true, locked: true, name: 'Hidden' })]), [PIECES[0]]);
  add('stack at every turn, spacing negative', layout([
    f('text', { id: 'a', x: 100, y: 100, rotation: 0, data: 'a\nb\nc', lineSpacing: -5 }), f('text', { id: 'b', x: 100, y: 100, rotation: 90, data: 'a\nb\nc', lineSpacing: -5 }),
    f('text', { id: 'c', x: 100, y: 100, rotation: 180, data: 'a\nb\nc', lineSpacing: -5 }), f('text', { id: 'd', x: 100, y: 100, rotation: 270, data: 'a\nb\nc', lineSpacing: -5 }),
  ]), [PIECES[0]]);
  add('windows line breaks', layout([f('text', { data: 'a\r\nb\rc' }), f('qr', { id: 'q', data: 'one\r\ntwo' })]), [PIECES[0]]);

  // Placeholders, dates and counters across a job.
  add('placeholders, dates and counters across a job', layout([
    f('text', { id: 'a', data: '{SKU_1}/{SKU_2} #{counter:7:1:3} {date:dd/MM/yy} {time:h:mm a}', width: 300 }),
    f('text', { id: 'b', data: '{price|prefix:Rs |suffix:/-} {name|upper|max:6} {weightNumber|fixed:1} {csv_nothing} {SKU_9}', y: 80 }),
    f('barcode', { id: 'c', data: '{counter::3:5}{SKU_2}', y: 120 }),
  ], { tags: 2 }), PIECES, { copies: 2, counterStart: 40 });
  add('the odd last piece prints its tag blank', layout([f('text', { data: '[{SKU_1}][{SKU_2}][{TOTAL_PRICE_PKR_2|prefix:#}]' })], { tags: 2 }), [PIECES[0], PIECES[1], PIECES[2]]);
  add('twelve tags', layout([f('text', { data: '{SKU_12}{SKU_13}{SKU_1}' })], { tags: 40 }), PIECES);
  add('no pieces', layout([f('text', { data: '{sku}' })], { tags: 2 }), []);
  add('only a skip', layout([f('text', { data: '{sku}' })]), [], { skip: 3 });
  add('copies and skip held', layout([f('text', { data: '{sku}' })]), [PIECES[0]], { copies: 100000, skip: 5000 });
  add('afternoon moment', layout([f('text', { data: '{date:EEEE d MMMM yyyy} {time:hh:mm:ss a} {date:yy-M-d H:m:s}' })]), [], { nowMs: AFTERNOON_MS });
  add('counter with a start that beats the placeholder', layout([f('text', { data: '{counter:1:2:5}' })]), [PIECES[0], PIECES[1], PIECES[2]], { counterStart: -3 });

  // The printer: a fixed order, every word, every number held.
  const all: LabelPrinterSettings = { thermal: 'direct', mode: 'peel', media: 'mark', darkness: 7, speed: 4, labelTop: 30, labelShift: -12, tearOff: -5, orientation: 'inverted', mirror: true, homeX: 8, homeY: 16 };
  add('printer: everything', layout([], { printer: all }), [PIECES[0]]);
  add('printer: older top-level darkness and speed', { ...layout([]), darkness: 12, speed: 3 } as StoredLabelLayout, [PIECES[0]]);
  add('printer: old top level beaten by printer', { ...layout([]), darkness: 12, speed: 3, printer: { darkness: 20 } } as StoredLabelLayout, [PIECES[0]]);
  const rnd = mulberry(20261025);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const maybe = <T>(v: T): T | undefined => (rnd() < 0.6 ? v : undefined);
  for (let i = 0; i < 160; i++) {
    const p: LabelPrinterSettings = {};
    const set = <K extends keyof LabelPrinterSettings>(k: K, v: LabelPrinterSettings[K] | undefined) => { if (v !== undefined) p[k] = v; };
    set('thermal', maybe(pick(['transfer', 'direct', 'bogus'] as never[])));
    set('mode', maybe(pick(['tear', 'peel', 'cutter', 'rewind', 'delayed-cut', 'bogus'] as never[])));
    set('media', maybe(pick(['gap', 'mark', 'continuous', 'bogus'] as never[])));
    set('darkness', maybe(Math.round(rnd() * 70 - 20)));
    set('speed', maybe(Math.round(rnd() * 26 - 4)));
    set('labelTop', maybe(Math.round(rnd() * 600 - 300)));
    set('labelShift', maybe(Math.round(rnd() * 30000 - 15000)));
    set('tearOff', maybe(Math.round(rnd() * 500 - 250)));
    set('orientation', maybe(pick(['normal', 'inverted', 'sideways'] as never[])));
    set('mirror', maybe(rnd() < 0.5));
    set('homeX', maybe(Math.round(rnd() * 400 - 100)));
    set('homeY', maybe(Math.round(rnd() * 400 - 100)));
    const dpi = pick([203, 300, 600, undefined]);
    add(`printer matrix ${i}`, layout([f('text', { data: '{sku}' })], { printer: p, dpi, widthDots: Math.round(rnd() * 900), heightDots: Math.round(rnd() * 500 - 20) }), [PIECES[0]], { copies: Math.round(rnd() * 12) });
  }
  return out;
}

function resolveCases(): ResolveCase[] {
  const templates = [
    '{sku} {name}', '{SKU_1}|{SKU_2}|{PRODUCT_NAME_2}|{METAL_WEIGHT_G_1}|{TOTAL_PRICE_PKR}', '{sku_2} {csv_sku}', '[{SKU_2}][{name_2}][{TOTAL_PRICE_PKR_2}]',
    '{skux} {SKU_0} {} {a b} {sku', '{{sku}} }{name}', '{date}', '{date:dd/MM/yy} {date:EEEE d MMMM yyyy}', '{time} {time:h:mm a} {time:HH:mm:ss}',
    "{date:yyyy-MM-dd 'at' H 'o''clock' EEE}", '{date:hh h m s a}', '{date:MMM MM M yy y yyyyyy}', '{date:\'unterminated}', '{counter}', '{counter:100:5:6}',
    '{counter::2:3}', '{counter:10:-3}', '{counter:1:1:4}', '{counter:abc:x:99}', '{price|prefix:Rs |suffix:/-}', '{priceNumber|prefix:Rs |suffix:/-}',
    '{name|upper} {name|lower}', '{weight|fixed:2} {weightNumber|fixed:1} {weightNumber|fixed:0} {weightNumber|fixed:25} {weightNumber|fixed:x}',
    '{priceNumber|group} {price|group} {csv_x|group} {name|group}', '{name|max:4}|{name|max:0}|{name|max:99}|{name|max:-1}|{name|max:2.9}', '{name|upper|max:3|suffix:.}',
    '[{SKU_2|prefix:#}]', '{name|nothing}', '{name|prefix}', '{name|:}', 'Ring — 22k {sku}', '{price|group}', '{SKU_00001}', '{sku_99999999999999999999}',
    '{Name}', '{PRICE}', '{csv:sku}', '{CSV_SKU}', '{metal_weight_g}', '{karat_1}{karat_2}', '{total_price_pkr_3|prefix:x}', '{date|upper}', '{counter|prefix:#|group}',
    '{ sku }', '{sku }', '{é}', '{name_1_2}',
  ];
  const out: ResolveCase[] = [];
  const sets: number[][] = [[0, 1, 2], [0], []];
  for (const template of templates) {
    for (const idx of sets) {
      const pieces = idx.map((i) => PIECES[i]);
      for (const [labelIndex, counterStart, nowMs] of [[0, undefined, NOW_MS], [3, 50, AFTERNOON_MS]] as [number, number | undefined, number][]) {
        out.push({ template, pieces: idx, labelIndex, counterStart, nowMs, text: resolveText(template, pieces, labelIndex, new Date(nowMs), counterStart) });
      }
    }
  }
  return out;
}

function dateCases(): DateCase[] {
  const patterns = ['yyyy-MM-dd', 'yy', 'y', 'MMMM', 'MMM', 'MM', 'M', 'dd', 'd', 'EEEE', 'EEE', 'E', 'HH:mm:ss', 'H:m:s', 'hh:mm a', 'h:mm a', 'a', "'text' d", "''", "d 'x''y' d", 'ddd', 'mmm', 'ss s', 'Q w z', ''];
  const out: DateCase[] = [];
  const moments = [NOW_MS, AFTERNOON_MS, Date.UTC(2026, 0, 1, 0, 0, 0), Date.UTC(2024, 1, 29, 7, 8, 9), Date.UTC(2026, 5, 15, 7, 0, 0), Date.UTC(2000, 11, 31, 19, 0, 0)];
  for (const pattern of patterns) for (const atMs of moments) out.push({ pattern, atMs, text: formatLabelDate(pattern, new Date(atMs)) });
  return out;
}

// A made-up design in Label LIVE's file shape (a 50 x 25 mm double tag at 203 dpi), the same as label-lsc.test.ts.
const PNG = `data:image/png;base64,${PNG_8X2}`;
const el = (type: string, config: object, extra: object = {}) => ({ id: 'x', type, config, hideOnPrint: false, ...extra });
const fo = (type: string, extra: object) => ({ type, left: 0, top: 0, width: 10, height: 10, scaleX: 1, scaleY: 1, angle: 0, originX: 'left', originY: 'top', ...extra });
const C = { originX: 'center', originY: 'center' };
const OBJECTS: [object, object][] = [
  [el('ELEMENT_TEXT', { text: '{SKU_1}\n{PRODUCT_NAME_1}' }), fo('textbox', { left: -150, top: -60, width: 100, height: 60, fontSize: 20, lineHeight: 1, textAlign: 'center' })],
  [el('ELEMENT_TEXT', { text: '{SKU_2}' }), fo('textbox', { left: 150, top: -80, width: 60, height: 30, fontSize: 10, lineHeight: 1.2, angle: 90 })],
  [el('ELEMENT_TEXT', { text: 'Right\r\nturned', textAlign: 'right' }), fo('textbox', { left: 60, top: 80, width: 70, height: 24, fontSize: 12.4, lineHeight: 1.3, scaleX: 1.5, scaleY: 1.5, angle: 270 })],
  [el('ELEMENT_TEXT', { text: 'Upside' }), fo('textbox', { left: -20, top: 90, width: 70, height: 24, fontSize: 14, lineHeight: 1, angle: 180, textAlign: 'left', ...C })],
  [el('ELEMENT_BARCODE', { bcid: 'qrcode', scale: 3, opts: { eclevel: 'Q' }, rotate: 'I', text: '{STALE}' }), fo('image', { left: -100, top: 50, width: 126, height: 126, scaleX: 0.5, scaleY: 0.5, ...C })],
  [el('ELEMENT_BARCODE', { bcid: 'microqrcode', scale: 0, eclevel: 'h', rotate: 'R', text: '{SKU_1}' }), fo('image', { left: 120, top: -20, width: 84, height: 84, ...C })],
  [el('ELEMENT_BARCODE', { bcid: 'code128', scale: 2, rotate: 'N', text: '{SKU_2}', opts: { includetext: true } }), fo('image', { left: 0, top: 70, width: 200, height: 80, ...C })],
  [el('ELEMENT_BARCODE', { bcid: 'ean13', rotate: 'B', text: '5901234123457', includetext: true }), fo('image', { left: 40, top: 30, width: 150, height: 60, angle: 90, ...C })],
  [el('ELEMENT_BARCODE', { bcid: 'azteccode', text: 'x' }), fo('image', {})],
  [el('ELEMENT_IMAGE', { kindId: 'DITHER_KIND_THRESHOLD' }), fo('image', { left: 100, top: 60, width: 8, height: 2, scaleX: 4, scaleY: 4, ...C, src: PNG })],
  [el('ELEMENT_IMAGE', { kindId: 'DITHER_KIND_ATKINSON' }), fo('image', { left: -120, top: 60, width: 8, height: 2, scaleX: 2, scaleY: 2, angle: 90, ...C, src: PNG })],
  [el('ELEMENT_IMAGE', { kindId: 'DITHER_KIND_FLOYD_STEINBERG', brightness: 0.1 }), fo('image', { left: -60, top: -70, width: 8, height: 2, scaleX: 3, scaleY: 3, angle: 180, ...C, src: `data:image/png;base64,${PNG_24X20}` })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 3 }), fo('line', { left: 0, top: -90, width: 100, height: 0, ...C, stroke: '#000000' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#FEFFFF', strokeWidth: 3 }), fo('line', { left: 0, top: 0, width: 200, height: 0, ...C, stroke: '#FEFFFF' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 2 }), fo('line', { left: 180, top: 0, width: 0, height: 60, ...C, stroke: '#000000' })],
  [el('ELEMENT_SHAPE_LINE', { stroke: '#000000', strokeWidth: 2 }), fo('line', { left: 0, top: 0, width: 50, height: 50, stroke: '#000000' })],
  [el('ELEMENT_SHAPE_RECT', { fill: null, stroke: '#000000', strokeWidth: 4 }), fo('rect', { left: -190, top: -95, width: 60, height: 30, rx: 15 })],
  [el('ELEMENT_SHAPE_RECT', { fill: '#000000', stroke: null, strokeWidth: 0 }, { hideOnPrint: true }), fo('rect', { left: -190, top: 60, width: 30, height: 30 })],
  [el('ELEMENT_SHAPE_RECT', { fill: 'rgb(255, 255, 255)', stroke: '#222222', strokeWidth: 1 }), fo('rect', { left: -20, top: -40, width: 40, height: 40, rx: 4, visible: false })],
  [el('ELEMENT_SHAPE_ELLIPSE', { fill: null, stroke: '#000000', strokeWidth: 2 }), fo('ellipse', { left: 100, top: 70, width: 40, height: 20, rx: 20, ry: 10 })],
  [el('ELEMENT_SHAPE_CIRCLE', { fill: '#111111', stroke: null }), fo('circle', { left: 30, top: -80, width: 0, height: 0, radius: 12 })],
  [el('ELEMENT_SPARKLE', {}), fo('group', {})],
  [el('ELEMENT_IMAGE', {}), fo('image', { src: 'data:image/jpeg;base64,/9j/4AAQ' })],
];

const lscDesign = (labelConfig: object, variables: object[]): string => JSON.stringify({
  version: '4.3.3', path: '/Users/someone/designs/private.lsc', labelConfig,
  canvasRecord: { fill: '#FEFFFF', objects: OBJECTS.map(([o]) => o), fabricRep: { version: '5.3.0', objects: OBJECTS.map(([, o]) => o) }, variables },
  ui: { windowName: 'SECRET-WINDOW' }, dataImport: { data: [{ SKU_1: 'SECRET-SAMPLE' }] },
});

function lscCases(): LscCase[] {
  const metric = { widthMeasure: '50', heightMeasure: '25', dpi: 203, metric: true, printerConfig: { DARKNESS: '18', SPEED: '4', THERMAL_MODE: 'THERMAL_MODE_DIRECT', MOCK_TARGET_PRINTER: 'PRIVATE-PRINTER-NAME' } };
  const inches = { widthMeasure: '2', heightMeasure: '1', dpi: 300, metric: false, printerConfig: { DARKNESS: '99', SPEED: '1', THERMAL_MODE: 'THERMAL_MODE_TRANSFER' } };
  const two = [{ name: 'SKU_1', value: 'S' }, { name: 'SKU_2', value: 'S' }, { name: 'PRODUCT_NAME_1', value: 'S' }];
  const one = [{ name: 'SKU', value: '' }, { name: 'PRICE_2', value: '' }];
  const out: LscCase[] = [];
  for (const [name, config, variables] of [['two tags at 203 dpi', metric, two], ['inches at 300 dpi, one tag', inches, one], ['metric 600 dpi odd size', { ...metric, dpi: 600, widthMeasure: '33.3', heightMeasure: 7 }, two]] as [string, object, object[]][]) {
    const lsc = lscDesign(config, variables);
    const layout = importLsc(lsc)!;
    out.push({ name, lsc, layout: json(layout), zpl: renderZpl(layout, PIECES, { now: new Date(NOW_MS), copies: 2 }) });
  }
  return out;
}

function bitmapCases(): BitmapCase[] {
  const out: BitmapCase[] = [];
  for (const [pngName, b64] of [['8x2', PNG_8X2], ['24x20', PNG_24X20]] as const) {
    const png = `data:image/png;base64,${b64}`;
    const img = decodePngDataUrl(png)!;
    for (const [width, height] of [[img.width, img.height], [4, 3], [37, 29], [64, 64], [5, 100]] as [number, number][]) {
      for (const dither of [undefined, 'threshold', 'atkinson', 'floyd'] as const) {
        for (const [threshold, brightness] of [[undefined, undefined], [0.3, 0], [0.7, -0.2], [undefined, 0.25]] as [number | undefined, number | undefined][]) {
          const bitmap = rasterToBitmap(img.rgba, img.width, img.height, width, height, { dither, threshold, brightness });
          out.push({ name: `${pngName} to ${width}x${height}`, png, width, height, dither, threshold, brightness, bitmap });
        }
      }
    }
  }
  return out;
}

export function goldenLabelCases() {
  return { pieces: PIECES, zpl: zplCases(), resolve: resolveCases(), dates: dateCases(), lsc: lscCases(), bitmaps: bitmapCases() };
}
