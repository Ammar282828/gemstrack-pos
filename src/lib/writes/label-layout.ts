/**
 * The tag the label designer draws (Settings → Labels, src/app/settings/printer), saved in the shop's
 * settings as `labelLayout` so it is the same on every device. The one copy of the standard tag and of the
 * check a saved layout passes, for the iPhone app (/api/app/write `saveLabelLayout`, ops-settings2.ts) and
 * for the page, whose `defaultLayout` is this `STANDARD_LABEL_LAYOUT`.
 *
 * `labelLayout` is not on `updateSettings`' list (lib/writes/settings.ts): it is a nested document, so it
 * has its own check here, field by field. Only the fields the designer knows are kept; a number is a
 * number, a rotation one of the four the designer offers.
 */

import type { DbPort, SideEffects } from '@/lib/db-port';
import type { LabelField, StoredLabelLayout } from '@/lib/label-layout';

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
const MAX_FIELDS = 50;
/** Far beyond any tag (a metre at 8 dots a millimetre): a number typed wrong is refused, not stored. */
const MAX_DOTS = 8000;

export type CleanedLabelLayout = { ok: true; layout: StoredLabelLayout } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null);

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

  const fields: LabelField[] = [];
  const seen = new Set<string>();
  for (const raw of input.fields) {
    if (!isObject(raw)) return fail('Each field is a text or a QR code.');
    const fid = text(raw.id, 100)?.trim();
    if (!fid || seen.has(fid)) return fail('Each field needs its own id.');
    if (raw.type !== 'text' && raw.type !== 'qr') return fail('A field is a text or a QR code.');
    if (!finite(raw.x) || !finite(raw.y) || Math.abs(raw.x) > MAX_DOTS || Math.abs(raw.y) > MAX_DOTS) return fail('A field\'s X and Y are numbers.');
    const data = text(raw.data, 500);
    if (data === null) return fail('A field\'s data is text.');
    const field: LabelField = { id: fid, type: raw.type, x: raw.x, y: raw.y, data };
    if (raw.rotation !== undefined && raw.rotation !== null) {
      if (!(LABEL_ROTATIONS as readonly unknown[]).includes(raw.rotation)) return fail('A field turns 0°, 90°, 180° or 270°.');
      field.rotation = raw.rotation as LabelField['rotation'];
    }
    if (raw.fontSize !== undefined && raw.fontSize !== null) {
      if (!finite(raw.fontSize) || raw.fontSize <= 0 || raw.fontSize > 1000) return fail('A field\'s font size is a number above 0.');
      field.fontSize = raw.fontSize;
    }
    if (raw.qrMagnification !== undefined && raw.qrMagnification !== null) {
      if (!finite(raw.qrMagnification) || raw.qrMagnification <= 0 || raw.qrMagnification > 100) return fail('A QR code\'s size is a number above 0.');
      field.qrMagnification = raw.qrMagnification;
    }
    if (raw.fontFamily !== undefined && raw.fontFamily !== null) {
      const font = text(raw.fontFamily, 100);
      if (font === null) return fail('A field\'s font is text.');
      field.fontFamily = font;
    }
    seen.add(fid);
    fields.push(field);
  }
  return { ok: true, layout: { id, name, widthDots, heightDots, fields } };
}

/** The layout saved into the shop's settings, as the page's `updateSettings({ labelLayout })` merges it. */
export async function saveLabelLayout(db: DbPort, layout: StoredLabelLayout, fx: SideEffects = {}): Promise<StoredLabelLayout> {
  const b = db.batch();
  b.set('app_settings', 'global', { labelLayout: layout }, true);
  await b.commit();
  void Promise.resolve(fx.log?.('settings.update', 'Label layout saved', `${layout.name} · ${layout.fields.length} field(s)`)).catch(() => undefined);
  return layout;
}
