/**
 * The tag the label designer draws (Settings → Labels, src/app/settings/printer), saved in the shop's
 * settings as `labelLayout` so it is the same on every device. The one copy of the standard tag and of the
 * check a saved layout passes, for the iPhone app (/api/app/write `saveLabelLayout`, ops-settings2.ts) and
 * for the page, whose `defaultLayout` is this `STANDARD_LABEL_LAYOUT`.
 *
 * `labelLayout` is not on `updateSettings`' list (lib/writes/settings.ts): it is a nested document, so it
 * has its own check here, field by field. Only the fields the designer knows are kept (each type keeps its own);
 * a number is a number within its range, a rotation one of the four the designer offers, a picture's bitmap
 * exactly its width by its height. An older layout (text and QR only) passes unchanged.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import { base64Decode, bitmapBytesPerRow } from '@/lib/label-bitmap';
import type { LabelField, LabelPrinterSettings, StoredLabelLayout } from '@/lib/label-layout';

/** The Zebra 2000T's dumbbell jewellery tag, 83 × 37 mm at 8 dots a millimetre: the SKU up the left, its QR on the right. */
export const STANDARD_LABEL_LAYOUT: StoredLabelLayout = {
  id: 'zebra-2000t-jewellery',
  name: 'Zebra 2000T Jewellery Tag (83x37mm)',
  widthDots: 664, // 83mm at 8dpmm
  heightDots: 296, // 37mm at 8dpmm
  fields: [
    { id: 'sku-left', type: 'text', x: 100, y: 150, data: 'SKU: {sku}', fontSize: 20, rotation: 90 },
    { id: 'qr-right', type: 'qr', x: 450, y: 80, data: '{sku}', qrMagnification: 4 },
  ],
};

export const LABEL_ROTATIONS = [0, 90, 180, 270] as const;
export const LABEL_FIELD_TYPES = ['text', 'qr', 'barcode', 'line', 'box', 'ellipse', 'image'] as const;
export const LABEL_SYMBOLOGIES = ['code128', 'code39', 'ean13', 'upca', 'datamatrix', 'pdf417'] as const;
const MAX_FIELDS = 200;
/** Far beyond any tag (a metre at 8 dots a millimetre): a number typed wrong is refused, not stored. */
const MAX_DOTS = 8000;
/** A picture's bitmap (and the PNG it came from) as base64 text: 64 KB each. */
export const MAX_IMAGE_TEXT = 64 * 1024;
/** All the pictures on a tag together: the settings document is one Firestore document, which holds a megabyte. */
const MAX_IMAGES_TOTAL = 700_000;

export type CleanedLabelLayout = { ok: true; layout: StoredLabelLayout } | { ok: false; error: string };

class Refused extends Error {}
const refuse = (message: string): never => { throw new Refused(message); };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);
const missing = (v: unknown): boolean => v === undefined || v === null;

/** A number from `raw[key]` between lo and hi (whole when `whole`), or undefined when it is not there. */
function number(raw: Record<string, unknown>, key: string, lo: number, hi: number, what: string, whole = false): number | undefined {
  const v = raw[key];
  if (missing(v)) return undefined;
  if (!finite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) return refuse(`${what} is ${whole ? 'a whole ' : 'a '}number from ${lo} to ${hi}.`);
  return v;
}
const flag = (raw: Record<string, unknown>, key: string, what: string): boolean | undefined => {
  const v = raw[key];
  if (missing(v)) return undefined;
  return typeof v === 'boolean' ? v : refuse(`${what} is on or off.`);
};
function oneOf<T extends string>(raw: Record<string, unknown>, key: string, allowed: readonly T[], what: string): T | undefined {
  const v = raw[key];
  if (missing(v)) return undefined;
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : refuse(`${what} is one of ${allowed.join(', ')}.`);
}
function str(raw: Record<string, unknown>, key: string, max: number, what: string): string | undefined {
  const v = raw[key];
  if (missing(v)) return undefined;
  return text(v, max) ?? refuse(`${what} is text.`);
}
const put = <T extends object>(target: T, key: string, value: unknown): void => { if (value !== undefined) (target as Record<string, unknown>)[key] = value; };

/** The printer's options, checked; undefined when none is set. */
function cleanPrinter(raw: unknown, top: Record<string, unknown>): LabelPrinterSettings | undefined {
  const src: Record<string, unknown> = {};
  if (!missing(raw)) {
    if (!isObject(raw)) return refuse('The printer\'s options are a list of settings.');
    Object.assign(src, raw);
  }
  // The old top-level darkness and speed are read when `printer` does not say.
  if (missing(src.darkness) && !missing(top.darkness)) src.darkness = top.darkness;
  if (missing(src.speed) && !missing(top.speed)) src.speed = top.speed;
  const p: LabelPrinterSettings = {};
  put(p, 'thermal', oneOf(src, 'thermal', ['transfer', 'direct'] as const, 'The thermal mode'));
  put(p, 'mode', oneOf(src, 'mode', ['tear', 'peel', 'cutter', 'rewind', 'delayed-cut'] as const, 'The print mode'));
  put(p, 'media', oneOf(src, 'media', ['gap', 'mark', 'continuous'] as const, 'The media type'));
  put(p, 'darkness', number(src, 'darkness', 0, 30, 'The darkness', true));
  put(p, 'speed', number(src, 'speed', 2, 14, 'The print speed', true));
  put(p, 'labelTop', number(src, 'labelTop', -120, 120, 'The label top', true));
  put(p, 'labelShift', number(src, 'labelShift', -9999, 9999, 'The label shift', true));
  put(p, 'tearOff', number(src, 'tearOff', -120, 120, 'The tear-off adjust', true));
  put(p, 'orientation', oneOf(src, 'orientation', ['normal', 'inverted'] as const, 'The print orientation'));
  put(p, 'mirror', flag(src, 'mirror', 'Mirror'));
  put(p, 'homeX', number(src, 'homeX', 0, MAX_DOTS, 'The home X', true));
  put(p, 'homeY', number(src, 'homeY', 0, MAX_DOTS, 'The home Y', true));
  return Object.keys(p).length ? p : undefined;
}

/** One field, checked: only the keys its type knows are kept. */
function cleanField(raw: Record<string, unknown>, fid: string, imageText: { used: number }): LabelField {
  const type = raw.type;
  if (typeof type !== 'string' || !(LABEL_FIELD_TYPES as readonly string[]).includes(type)) return refuse('A field is a text, a QR code, a barcode, a line, a box, an ellipse or a picture.');
  if (!finite(raw.x) || !finite(raw.y) || Math.abs(raw.x) > MAX_DOTS || Math.abs(raw.y) > MAX_DOTS) return refuse('A field\'s X and Y are numbers.');
  const field: LabelField = { id: fid, type: type as LabelField['type'], x: raw.x, y: raw.y };
  if (!missing(raw.rotation)) {
    if (!(LABEL_ROTATIONS as readonly unknown[]).includes(raw.rotation)) return refuse('A field turns 0°, 90°, 180° or 270°.');
    field.rotation = raw.rotation as LabelField['rotation'];
  }
  put(field, 'hidden', flag(raw, 'hidden', 'Hidden'));
  put(field, 'locked', flag(raw, 'locked', 'Locked'));
  put(field, 'name', str(raw, 'name', 100, 'A field\'s name'));

  if (type === 'text' || type === 'qr' || type === 'barcode') {
    const data = text(raw.data, 500);
    if (data === null) return refuse('A field\'s data is text.');
    field.data = data;
  }
  if (type === 'text') {
    if (!missing(raw.fontSize) && (!finite(raw.fontSize) || raw.fontSize <= 0 || raw.fontSize > 1000)) return refuse('A field\'s font size is a number above 0.');
    put(field, 'fontSize', raw.fontSize ?? undefined);
    put(field, 'fontFamily', str(raw, 'fontFamily', 100, 'A field\'s font'));
    put(field, 'width', number(raw, 'width', 1, MAX_DOTS, 'A text\'s width'));
    put(field, 'lines', number(raw, 'lines', 1, 50, 'A text\'s lines', true));
    put(field, 'lineSpacing', number(raw, 'lineSpacing', -500, 500, 'A text\'s line spacing'));
    put(field, 'align', oneOf(raw, 'align', ['L', 'C', 'R'] as const, 'A text\'s alignment'));
    put(field, 'bold', flag(raw, 'bold', 'Bold'));
  } else if (type === 'qr') {
    if (!missing(raw.qrMagnification) && (!finite(raw.qrMagnification) || raw.qrMagnification <= 0 || raw.qrMagnification > 100)) return refuse('A QR code\'s size is a number above 0.');
    put(field, 'qrMagnification', raw.qrMagnification ?? undefined);
    put(field, 'errorCorrection', oneOf(raw, 'errorCorrection', ['L', 'M', 'Q', 'H'] as const, 'A QR code\'s error correction'));
  } else if (type === 'barcode') {
    put(field, 'symbology', oneOf(raw, 'symbology', LABEL_SYMBOLOGIES, 'A barcode\'s kind'));
    put(field, 'height', number(raw, 'height', 1, 2000, 'A barcode\'s height'));
    put(field, 'moduleWidth', number(raw, 'moduleWidth', 1, 10, 'A barcode\'s bar width', true));
    put(field, 'showText', flag(raw, 'showText', 'Show text'));
  } else {
    const w = number(raw, 'width', 1, MAX_DOTS, 'A shape\'s width'), h = number(raw, 'height', 1, MAX_DOTS, 'A shape\'s height');
    if (w === undefined || h === undefined) return refuse(`A ${type} needs its width and height.`);
    field.width = w;
    field.height = h;
    if (type === 'image') {
      if (!Number.isInteger(w) || !Number.isInteger(h)) return refuse('A picture\'s width and height are whole dots.');
      const bitmap = text(raw.bitmap, MAX_IMAGE_TEXT);
      if (bitmap === null) return refuse('A picture needs its bitmap, up to 64 KB of base64.');
      const bytes = base64Decode(bitmap);
      if (!bytes || bytes.length !== bitmapBytesPerRow(w) * h) return refuse('A picture\'s bitmap is not its width by its height.');
      field.bitmap = bitmap;
      imageText.used += bitmap.length;
      put(field, 'dither', oneOf(raw, 'dither', ['threshold', 'atkinson', 'floyd'] as const, 'A picture\'s dither'));
      put(field, 'threshold', number(raw, 'threshold', 0, 1, 'A picture\'s threshold'));
      if (!missing(raw.source)) {
        const source = text(raw.source, MAX_IMAGE_TEXT);
        if (source === null || !source.startsWith('data:image/')) return refuse('A picture\'s source is an image under 64 KB.');
        field.source = source;
        imageText.used += source.length;
      }
    } else {
      put(field, 'thickness', number(raw, 'thickness', 0, MAX_DOTS, 'A shape\'s thickness'));
      if (type === 'box') put(field, 'rounding', number(raw, 'rounding', 0, 8, 'A box\'s rounding', true));
      put(field, 'fill', flag(raw, 'fill', 'Fill'));
    }
  }
  return field;
}

/** The layout as the designer edits it, checked; anything else posted is dropped. */
export function cleanLabelLayout(input: unknown): CleanedLabelLayout {
  if (!isObject(input)) return fail('The tag is a layout with its fields.');
  const id = text(input.id, 100)?.trim();
  const name = text(input.name, 120)?.trim();
  if (!id || name === undefined) return fail('The tag needs its id and name.');
  const { widthDots, heightDots } = input;
  if (!finite(widthDots) || !finite(heightDots) || widthDots <= 0 || heightDots <= 0 || widthDots > MAX_DOTS || heightDots > MAX_DOTS) {
    return fail('The tag\'s size is a width and a height in dots.');
  }
  if (!Array.isArray(input.fields) || input.fields.length > MAX_FIELDS) return fail(`A tag holds up to ${MAX_FIELDS} fields.`);

  try {
    const layout: StoredLabelLayout = { id, name, widthDots, heightDots, fields: [] };
    if (!missing(input.dpi)) {
      if (![203, 300, 600].includes(input.dpi as number)) return fail('The printer is 203, 300 or 600 dots an inch.');
      layout.dpi = input.dpi as number;
    }
    put(layout, 'tags', number(input, 'tags', 1, 12, 'The pieces to a label', true));
    const printer = cleanPrinter(input.printer, input);
    if (printer) layout.printer = printer;

    const seen = new Set<string>();
    const imageText = { used: 0 };
    for (const raw of input.fields) {
      if (!isObject(raw)) return fail('Each field is an object.');
      const fid = text(raw.id, 100)?.trim();
      if (!fid || seen.has(fid)) return fail('Each field needs its own id.');
      layout.fields.push(cleanField(raw, fid, imageText));
      seen.add(fid);
    }
    if (imageText.used > MAX_IMAGES_TOTAL) return fail('The pictures on the tag are too big together; use smaller ones.');
    return { ok: true, layout };
  } catch (e) {
    if (e instanceof Refused) return fail(e.message);
    throw e;
  }
}

/** The layout saved into the shop's settings, as the page's `updateSettings({ labelLayout })` merges it. */
export async function saveLabelLayout(db: DbPort, layout: StoredLabelLayout, fx: SideEffects = {}): Promise<StoredLabelLayout> {
  const b = db.batch();
  b.set('app_settings', 'global', { labelLayout: layout }, true);
  await b.commit();
  void Promise.resolve(fx.log?.('settings.update', 'Label layout saved', `${layout.name} · ${layout.fields.length} field(s)`)).catch(() => undefined);
  return layout;
}
