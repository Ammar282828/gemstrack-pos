/**
 * Label LIVE (label.live) designs → the ERP's tag layout. A design is a `.lsc` file (JSON): `labelConfig` has the
 * label's size and dpi, `canvasRecord.objects[i]` what each object is (its type, and for text and barcodes the
 * text with its `{VARIABLES}`), `canvasRecord.fabricRep.objects[i]` where it sits (fabric.js 5: dots from the
 * label's CENTRE, each object's own origin, scale and angle).
 *
 * Only geometry and the variables' NAMES are read: never `dataImport`, a variable's `value`, a path or the window (`ui`).
 * What cannot be drawn on a tag (a slanted line, an unknown element) is left out. ERPCore's LabelLSC.swift does
 * the same, step for step.
 */

import { base64Encode, bitmapBytes, rasterToBitmap, rotateBitmap } from '@/lib/label-bitmap';
import { decodePngDataUrl, type DecodedImage } from '@/lib/png-decode';
import type { LabelField, LabelPrinterSettings, LabelSymbology, StoredLabelLayout } from '@/lib/label-layout';

export interface LscOptions {
  id?: string;
  name?: string;
  /** For a picture that is not a PNG (the browser can decode a JPEG through a canvas); a PNG needs none. */
  decodeImage?: (dataUrl: string) => DecodedImage | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : dflt);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** The largest source text a picture may keep (see lib/writes/label-layout.ts). */
const MAX_SOURCE = 64 * 1024;

interface Box { x: number; y: number; w: number; h: number; turn: 0 | 90 | 180 | 270; cx: number; cy: number }

/** Where a fabric object sits on the label: the corner of its rotated box, from the label's top-left, and its own size. */
function boxOf(fo: Obj, W: number, H: number, width: number, height: number): Box {
  const w = width * Math.abs(num(fo.scaleX, 1)), h = height * Math.abs(num(fo.scaleY, 1));
  const ox = fo.originX === 'center' ? 0.5 : fo.originX === 'right' ? 1 : 0;
  const oy = fo.originY === 'center' ? 0.5 : fo.originY === 'bottom' ? 1 : 0;
  const quarter = ((Math.round(num(fo.angle) / 90) % 4) + 4) % 4;
  const turn = (quarter * 90) as Box['turn'];
  const c = [1, 0, -1, 0][quarter], s = [0, 1, 0, -1][quarter];
  const rx = (px: number, py: number) => px * c - py * s;
  const ry = (px: number, py: number) => px * s + py * c;
  // Fabric turns an object about its origin point, so the origin stays put: the object's own top-left is found from it.
  const tlx = num(fo.left) - rx(ox * w, oy * h), tly = num(fo.top) - ry(ox * w, oy * h);
  const xs = [0, rx(w, 0), rx(0, h), rx(w, h)].map((v) => tlx + v);
  const ys = [0, ry(w, 0), ry(0, h), ry(w, h)].map((v) => tly + v);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  return {
    x: minX + W / 2, y: minY + H / 2,
    w: turn === 90 || turn === 270 ? h : w, h: turn === 90 || turn === 270 ? w : h,
    turn, cx: (minX + maxX) / 2 + W / 2, cy: (minY + maxY) / 2 + H / 2,
  };
}

const WHITE = new Set(['#fff', '#ffffff', 'white', 'rgb(255,255,255)', 'rgb(255, 255, 255)']);
function invisible(color: unknown, labelFill: string): boolean {
  if (typeof color !== 'string') return true;
  const c = color.trim().toLowerCase();
  return c === '' || c === 'transparent' || c === 'none' || c === labelFill || WHITE.has(c);
}

const SYMBOLOGIES: Record<string, LabelSymbology> = {
  code128: 'code128', gs1128: 'code128', code39: 'code39', ean13: 'ean13', upca: 'upca', datamatrix: 'datamatrix', pdf417: 'pdf417',
};
const LETTER_TURN: Record<string, number> = { N: 0, R: 90, I: 180, B: 270 };

/** A fabric/Label LIVE design as a layout; null when the text is not one. */
export function importLsc(input: unknown, opts: LscOptions = {}): StoredLabelLayout | null {
  let root: unknown = input;
  if (typeof input === 'string') { try { root = JSON.parse(input); } catch { return null; } }
  if (!isObj(root) || !isObj(root.labelConfig) || !isObj(root.canvasRecord)) return null;
  const lc = root.labelConfig, cr = root.canvasRecord;

  const dpi = num(lc.dpi, 203) > 0 ? num(lc.dpi, 203) : 203;
  const toDots = (m: unknown): number => {
    const v = parseFloat(str(m) || String(num(m)));
    return Math.max(1, Math.round(lc.metric === false ? v * dpi : (v * dpi) / 25.4));
  };
  const W = toDots(lc.widthMeasure), H = toDots(lc.heightMeasure);
  if (!Number.isFinite(W) || !Number.isFinite(H)) return null;

  const objects = Array.isArray(cr.objects) ? cr.objects : [];
  const fabric = isObj(cr.fabricRep) && Array.isArray(cr.fabricRep.objects) ? cr.fabricRep.objects : [];
  const labelFill = str(cr.fill).trim().toLowerCase();
  const decode = opts.decodeImage ?? decodePngDataUrl;

  const names = new Set<string>();
  for (const v of Array.isArray(cr.variables) ? cr.variables : []) if (isObj(v) && typeof v.name === 'string') names.add(v.name);

  const fields: LabelField[] = [];
  const centres: { cx: number; cy: number }[] = [];
  for (let i = 0; i < Math.min(objects.length, fabric.length); i++) {
    const rec = objects[i], fo = fabric[i];
    if (!isObj(rec) || !isObj(fo)) continue;
    const cfg = isObj(rec.config) ? rec.config : {};
    const kind = str(rec.type);
    const base = (b: Box, type: LabelField['type'], name: string): LabelField => {
      const f: LabelField = { id: `lsc-${i + 1}`, type, x: Math.round(b.x), y: Math.round(b.y), name };
      if (rec.hideOnPrint === true || fo.hideOnPrint === true || fo.visible === false) f.hidden = true;
      return f;
    };
    const widthOf = num(fo.width), heightOf = num(fo.height);
    const push = (f: LabelField, b: Box) => { fields.push(f); centres.push({ cx: b.cx, cy: b.cy }); };

    if (kind === 'ELEMENT_TEXT') {
      const data = str(cfg.text).replace(/\r\n?/g, '\n');
      const b = boxOf(fo, W, H, widthOf, heightOf);
      const scaleY = Math.abs(num(fo.scaleY, 1));
      const fs = Math.max(1, Math.round(num(fo.fontSize, 20) * scaleY));
      const f = base(b, 'text', 'Text');
      f.data = data;
      f.fontSize = fs;
      f.width = Math.max(1, Math.round(widthOf * Math.abs(num(fo.scaleX, 1))));
      f.lines = data.split('\n').length;
      const pitch = Math.round(num(fo.fontSize, 20) * num(fo.lineHeight, 1) * 1.13 * scaleY);
      if (pitch - fs !== 0) f.lineSpacing = pitch - fs;
      const align = str(fo.textAlign || cfg.textAlign);
      if (align === 'center') f.align = 'C'; else if (align === 'right') f.align = 'R';
      if (b.turn !== 0) f.rotation = b.turn;
      push(f, b);
    } else if (kind === 'ELEMENT_BARCODE') {
      const bcid = str(cfg.bcid).toLowerCase();
      const b = boxOf(fo, W, H, widthOf, heightOf);
      const turn = ((b.turn + (LETTER_TURN[str(cfg.rotate)] ?? 0)) % 360) as 0 | 90 | 180 | 270;
      const data = str(cfg.text).replace(/\r\n?/g, '\n');
      const scale = num(cfg.scale, 0);
      if (bcid === 'qrcode' || bcid === 'microqrcode') {
        const f = base(b, 'qr', 'QR code');
        f.data = data;
        f.qrMagnification = scale >= 1 && scale <= 10 ? Math.round(scale) : clamp(Math.round(b.w / 21), 1, 10);
        const opts2 = isObj(cfg.opts) ? cfg.opts : {};
        const ec = str(opts2.eclevel || cfg.eclevel).toUpperCase();
        f.errorCorrection = ec === 'L' || ec === 'Q' || ec === 'H' ? ec : 'M';
        if (turn !== 0) f.rotation = turn;
        push(f, b);
      } else if (SYMBOLOGIES[bcid]) {
        const f = base(b, 'barcode', 'Barcode');
        f.data = data;
        f.symbology = SYMBOLOGIES[bcid];
        f.height = Math.max(1, Math.round(turn === 90 || turn === 270 ? b.w : b.h));
        f.moduleWidth = clamp(Math.round(scale || 2), 1, 10);
        const inner = isObj(cfg.opts) ? cfg.opts : {};
        if (cfg.includetext === true || inner.includetext === true) f.showText = true;
        if (turn !== 0) f.rotation = turn;
        push(f, b);
      }
    } else if (kind === 'ELEMENT_IMAGE') {
      const src = str(fo.src);
      const img = src ? decode(src) : null;
      if (!img) continue;
      const b = boxOf(fo, W, H, widthOf, heightOf);
      // The picture is made at its drawn size in its own orientation, then turned a quarter at a time for 90° and 270°.
      const drawnW = Math.max(1, Math.round(widthOf * Math.abs(num(fo.scaleX, 1)))), drawnH = Math.max(1, Math.round(heightOf * Math.abs(num(fo.scaleY, 1))));
      const kindId = str(cfg.kindId);
      const dither = kindId.includes('ATKINSON') ? 'atkinson' : kindId.includes('FLOYD') ? 'floyd' : 'threshold';
      let bitmap = rasterToBitmap(img.rgba, img.width, img.height, drawnW, drawnH, { dither, brightness: typeof cfg.brightness === 'number' ? cfg.brightness : 0 });
      let w = drawnW, h = drawnH;
      if (b.turn === 90 || b.turn === 270) {
        const bytes = bitmapBytes(bitmap, drawnW, drawnH);
        if (bytes) {
          const r = rotateBitmap(bytes, drawnW, drawnH, b.turn === 90 ? 1 : 3);
          bitmap = base64Encode(r.bytes);
          w = r.width; h = r.height;
        }
      }
      const f = base(b, 'image', 'Picture');
      f.width = w;
      f.height = h;
      f.bitmap = bitmap;
      f.dither = dither;
      if (b.turn === 180) f.rotation = 180;
      if (src.length <= MAX_SOURCE) f.source = src;
      push(f, b);
    } else if (kind === 'ELEMENT_SHAPE_LINE') {
      const stroke = cfg.stroke ?? fo.stroke;
      if (invisible(stroke, labelFill)) continue;
      // Straight lines only: a horizontal or a vertical one becomes a filled bar of its stroke's width, around the line's centre.
      const b = boxOf(fo, W, H, widthOf, heightOf);
      const thick = Math.max(1, Math.round(num(cfg.strokeWidth, num(fo.strokeWidth, 1))));
      const horizontal = b.h < 0.5, vertical = b.w < 0.5;
      if (horizontal === vertical) continue;
      const bw = Math.max(1, Math.round(horizontal ? b.w : thick)), bh = Math.max(1, Math.round(horizontal ? thick : b.h));
      const f = base(b, 'line', 'Line');
      f.x = Math.round(b.cx - bw / 2);
      f.y = Math.round(b.cy - bh / 2);
      f.width = bw;
      f.height = bh;
      push(f, b);
    } else if (kind === 'ELEMENT_SHAPE_RECT' || kind === 'ELEMENT_SHAPE_ELLIPSE' || kind === 'ELEMENT_SHAPE_CIRCLE') {
      const fillShown = !invisible(cfg.fill ?? fo.fill, labelFill);
      const strokeShown = !invisible(cfg.stroke ?? fo.stroke, labelFill) && num(cfg.strokeWidth, num(fo.strokeWidth, 0)) > 0;
      if (!fillShown && !strokeShown) continue;
      const rx = num(fo.rx), ry = num(fo.ry), radius = num(fo.radius);
      const ew = kind === 'ELEMENT_SHAPE_RECT' ? widthOf : widthOf || rx * 2 || radius * 2;
      const eh = kind === 'ELEMENT_SHAPE_RECT' ? heightOf : heightOf || ry * 2 || radius * 2;
      const b = boxOf(fo, W, H, ew, eh);
      const f = base(b, kind === 'ELEMENT_SHAPE_RECT' ? 'box' : 'ellipse', kind === 'ELEMENT_SHAPE_RECT' ? 'Box' : 'Ellipse');
      f.width = Math.max(1, Math.round(b.w));
      f.height = Math.max(1, Math.round(b.h));
      if (fillShown) f.fill = true;
      else f.thickness = Math.max(1, Math.round(num(cfg.strokeWidth, num(fo.strokeWidth, 1))));
      if (kind === 'ELEMENT_SHAPE_RECT' && num(fo.rx) > 0) f.rounding = clamp(Math.round((num(fo.rx) / (Math.min(ew, eh) / 2)) * 8), 0, 8);
      push(f, b);
    }
  }

  // A design of several tags names its variables `X_1`, `X_2`: the highest number is how many pieces a label takes.
  const tagsSeen = new Set<number>();
  const note = (name: string) => { const m = /_(\d{1,2})$/.exec(name); if (m && Number(m[1]) > 0) tagsSeen.add(Number(m[1])); };
  names.forEach(note);
  const tags = tagsSeen.size >= 2 ? Math.min(12, Math.max(...tagsSeen)) : 1;

  // A QR or barcode whose text is one `{name}` that is not a variable of the design is a sample left in the file
  // (it would print the braces): it takes the SKU of the nearest text's tag instead.
  fields.forEach((f, k) => {
    if ((f.type !== 'qr' && f.type !== 'barcode') || typeof f.data !== 'string') return;
    const m = /^\{([^{}]*)\}$/.exec(f.data);
    if (!m || names.has(m[1])) return;
    let tag = 0, best = Infinity;
    fields.forEach((t, j) => {
      if (t.type !== 'text') return;
      const mm = /\{[^{}]*_(\d{1,2})(?:\|[^{}]*)?\}/.exec(t.data ?? '');
      if (!mm) return;
      const d = (centres[j].cx - centres[k].cx) ** 2 + (centres[j].cy - centres[k].cy) ** 2;
      if (d < best) { best = d; tag = Number(mm[1]); }
    });
    f.data = tags > 1 && tag > 0 ? `{SKU_${tag}}` : '{sku}';
  });

  const layout: StoredLabelLayout = {
    id: opts.id ?? 'lsc-import',
    name: opts.name ?? 'Imported design',
    widthDots: W,
    heightDots: H,
    dpi: [203, 300, 600].includes(dpi) ? dpi : 203,
    fields,
  };
  if (tags > 1) layout.tags = tags;
  const pc = isObj(lc.printerConfig) ? lc.printerConfig : {};
  const printer: LabelPrinterSettings = {};
  const thermal = str(pc.THERMAL_MODE).toUpperCase();
  if (thermal.endsWith('TRANSFER')) printer.thermal = 'transfer'; else if (thermal.endsWith('DIRECT')) printer.thermal = 'direct';
  const dark = Math.round(parseFloat(str(pc.DARKNESS)));
  if (Number.isFinite(dark) && dark >= 0 && dark <= 30) printer.darkness = dark;
  const speed = Math.round(parseFloat(str(pc.SPEED)));
  if (Number.isFinite(speed) && speed >= 2 && speed <= 14) printer.speed = speed;
  if (Object.keys(printer).length) layout.printer = printer;
  return layout;
}
