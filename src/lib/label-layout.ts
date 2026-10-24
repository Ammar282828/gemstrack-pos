/**
 * The tag the label designer (Settings → Labels) draws, kept in settings as `labelLayout` so the
 * shop's layout survives a reload and is the same on every device (it was page state only).
 *
 * Every position is in printer dots from the label's TOP-LEFT. A field's x, y is the top-left corner of its
 * (rotated) box, as ZPL's ^FO has it: a field turned 90° still sits with that corner at x, y.
 * An older layout (text and QR fields only) loads, prints and saves unchanged: everything added since is optional.
 * The ZPL it prints as is lib/zebra-zpl.ts; the same rules, to the byte, are ERPCore's Zpl.swift.
 */

export type LabelFieldType = 'text' | 'qr' | 'barcode' | 'line' | 'box' | 'ellipse' | 'image';
export type LabelRotation = 0 | 90 | 180 | 270;
export type LabelSymbology = 'code128' | 'code39' | 'ean13' | 'upca' | 'datamatrix' | 'pdf417';
export type LabelDither = 'threshold' | 'atkinson' | 'floyd';

export interface LabelField {
  id: string;
  type: LabelFieldType;
  x: number;
  y: number;
  rotation?: LabelRotation;
  /** text, qr, barcode: may hold `{placeholders}`; text may hold `\n`. */
  data?: string;
  /** The designer's: a hidden field is skipped on print (Label LIVE's "hide on print"). */
  hidden?: boolean;
  /** The designer's: it cannot be dragged. */
  locked?: boolean;
  /** The designer's: a label for the layers list. */
  name?: string;

  // text
  fontFamily?: string;
  /** Dots, cap height; 20 when unset. */
  fontSize?: number;
  /** text: with a width the text wraps and aligns in a ^FB block. line, box, ellipse, image: the size. */
  width?: number;
  /** Text: most lines in the block (1, or the count of `\n` + 1 when unset). */
  lines?: number;
  /** Text: dots between lines, may be negative. */
  lineSpacing?: number;
  align?: 'L' | 'C' | 'R';
  /** ZPL has no weight: drawn twice, a dot apart. */
  bold?: boolean;

  // qr
  qrMagnification?: number;
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';

  // barcode
  symbology?: LabelSymbology;
  /** barcode: bar height in dots (40 when unset). line, box, ellipse, image: the size. */
  height?: number;
  moduleWidth?: number;
  showText?: boolean;

  // line, box, ellipse
  thickness?: number;
  rounding?: number;
  fill?: boolean;

  // image
  /** Base64 of the monochrome picture, 1 bit a pixel, rows padded to whole bytes, 1 = black (^GFA's data). */
  bitmap?: string;
  dither?: LabelDither;
  threshold?: number;
  /** The picture it was made from (a PNG data URL), kept only when under 64 KB. */
  source?: string;
}

/** What the printer is told before each label (Label LIVE's printer options). */
export interface LabelPrinterSettings {
  thermal?: 'transfer' | 'direct';
  mode?: 'tear' | 'peel' | 'cutter' | 'rewind' | 'delayed-cut';
  media?: 'gap' | 'mark' | 'continuous';
  /** 0–30 (~SD). */
  darkness?: number;
  /** Inches a second, 2–14 (^PR). */
  speed?: number;
  /** -120..120 (^LT). */
  labelTop?: number;
  /** -9999..9999 (^LS). */
  labelShift?: number;
  /** -120..120 (~TA). */
  tearOff?: number;
  orientation?: 'normal' | 'inverted';
  mirror?: boolean;
  /** ^LH. */
  homeX?: number;
  homeY?: number;
}

export interface StoredLabelLayout {
  id: string;
  name: string;
  widthDots: number;
  heightDots: number;
  /** 203 when unset; 300 and 600 are allowed. */
  dpi?: number;
  /** Pieces to a label: 1 when unset, 2 for a double (butterfly) tag. */
  tags?: number;
  /** Older layouts kept these two here; `printer.darkness` / `printer.speed` replace them (both are read). */
  darkness?: number;
  speed?: number;
  printer?: LabelPrinterSettings;
  fields: LabelField[];
}

/** The printer options with the old top-level darkness and speed folded in; `printer` wins. */
export function printerOf(layout: Pick<StoredLabelLayout, 'printer' | 'darkness' | 'speed'>): LabelPrinterSettings {
  const p: LabelPrinterSettings = { ...(layout.printer ?? {}) };
  if (p.darkness === undefined && layout.darkness !== undefined) p.darkness = layout.darkness;
  if (p.speed === undefined && layout.speed !== undefined) p.speed = layout.speed;
  return p;
}

/** Pieces to a label. */
export const tagsOfLayout = (layout: Pick<StoredLabelLayout, 'tags'>): number => {
  const n = Math.round(Number(layout.tags));
  return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : 1;
};
