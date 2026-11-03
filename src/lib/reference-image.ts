/**
 * A piece's printed reference picture (owner, 2026-11-03: "print the reference image onto the bill next to the
 * icon"): `referenceImage` is an https URL (a catalogue photo), `printReference` the switch. Shared by the order
 * and sale write paths and the PDFs.
 */

/** A reference picture's address as kept: an https URL of at most 1000 characters, else nothing. */
export function cleanReferenceImage(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s]+$/.test(s) && s.length <= 1000 ? s : undefined;
}

/** Pictures fetched for one document at most (each marked piece prints its own, beside its name). */
const MAX_WANTED = 24;

/** What an order or sale line says about its printed picture. */
export type ReferenceFields = { referenceImage?: string; printReference?: boolean };

/** The key a picture is held under in PdfImages.references: its address, or `own:<index>` when the piece's own photo is meant. */
export const referenceKey = (item: ReferenceFields, index: number): string => cleanReferenceImage(item.referenceImage) ?? `own:${index}`;

/** The pieces that want a picture printed, and what to fetch for each: the URL, or (`own`) the piece's own first photo. */
export function wantedReferences<T extends ReferenceFields>(items: readonly T[]): { key: string; url?: string; index: number; item: T }[] {
  const out: { key: string; url?: string; index: number; item: T }[] = [];
  items.forEach((item, index) => {
    if (out.length >= MAX_WANTED || item?.printReference !== true) return;
    const url = cleanReferenceImage(item.referenceImage);
    const key = referenceKey(item, index);
    if (!out.some(o => o.key === key)) out.push({ key, ...(url && { url }), index, item });
  });
  return out;
}
