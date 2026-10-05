/**
 * A piece's size, read as the customer's ring, bangle or bracelet size — so the order form can offer
 * to keep it in their profile (Customer.ringSize / bangleSize / braceletSize) for next time.
 *
 * The owner, 2026-10-05: "when creating an order for a customer and adding any ring or bangle or
 * bracelet size, show a popup to save the size in the customer bio for the future if the customer
 * size is not already in their bio. If it is in the bio then no popup."
 *
 * Which field a size belongs to comes from the piece's category (SIZE_SCALES in store.ts): rings,
 * bands and the ring of a set are the ring size; bangles and a locket set's bangle the bangle size;
 * bracelets, a loose bracelet and a set's bracelet the bracelet size. A chain or string length is
 * none of them.
 */

import { isMultiPartScale, legacyPartKeyFor, parseMultiSize, sizeScaleFor } from '@/lib/store';
import type { Customer } from '@/lib/store';

export type ProfileSizeField = 'ringSize' | 'bangleSize' | 'braceletSize';

export const PROFILE_SIZE_LABEL: Record<ProfileSizeField, string> = {
  ringSize: 'Ring size',
  bangleSize: 'Bangle size',
  braceletSize: 'Bracelet size',
};

/** Single-size categories, by what they measure. */
const SINGLE: Record<string, ProfileSizeField> = {
  cat001: 'ringSize',   // Rings
  cat018: 'ringSize',   // Men's rings
  cat009: 'ringSize',   // Bands
  cat010: 'ringSize',   // Locket set without bangle: its ring
  cat013: 'ringSize',   // Stone necklace set without bracelets: its ring
  cat016: 'ringSize',   // Gold necklace set without bracelets: its ring
  cat007: 'bangleSize', // Bangles
  cat005: 'braceletSize', // Bracelets
  cat019: 'braceletSize', // Loose bracelet
};

/** The part names a multi-part size is written with ("Ring: 10 · Bangle: 2.4"). */
const PART: Record<string, ProfileSizeField> = { Ring: 'ringSize', Bangle: 'bangleSize', Bracelet: 'braceletSize' };

/** The profile sizes a piece's size gives: { ringSize: '12' }, { ringSize: '10', bangleSize: '2.4' }, or {}. */
export function profileSizesOf(categoryId: string | undefined, size: string | undefined | null): Partial<Record<ProfileSizeField, string>> {
  const value = String(size || '').trim();
  if (!categoryId || !value) return {};
  const scale = sizeScaleFor(categoryId);
  if (isMultiPartScale(scale)) {
    const out: Partial<Record<ProfileSizeField, string>> = {};
    for (const [part, v] of Object.entries(parseMultiSize(value, legacyPartKeyFor(scale)))) {
      const field = PART[part];
      if (field && v.trim()) out[field] = v.trim();
    }
    return out;
  }
  const field = SINGLE[categoryId];
  return field ? { [field]: value } : {};
}

/**
 * Sizes compare as the counter writes them: "12", " 12 ", "12.0" are one size, "US 6"/"us 6" one, and a
 * bracelet's inches with or without the mark — 7, 7", 7 in, 7 inches — one.
 */
export const sameSize = (a: string | undefined | null, b: string | undefined | null) => {
  const norm = (s: string | undefined | null) => {
    const t = String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const m = /^(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches)?$/.exec(t);
    return m ? String(Number(m[1])) : t;
  };
  return norm(a) === norm(b);
};

export interface SizeSuggestion {
  field: ProfileSizeField;
  /** The size on the order. */
  value: string;
  /** What the profile holds now, if anything. */
  current?: string;
  /** For not asking twice: customer, field and value. */
  key: string;
}

/**
 * What the order's pieces give that the profile doesn't hold yet — one per field, the last piece's
 * size where two differ. `who` keys a decision to its customer, so choosing another customer asks again.
 */
export function sizeSuggestions(
  who: string,
  profile: Partial<Pick<Customer, ProfileSizeField>> | null | undefined,
  items: { itemCategory?: string; size?: string | null }[],
  decided: ReadonlySet<string> = new Set(),
): SizeSuggestion[] {
  const latest = new Map<ProfileSizeField, string>();
  for (const it of items || []) {
    for (const [field, value] of Object.entries(profileSizesOf(it?.itemCategory, it?.size)) as [ProfileSizeField, string][]) {
      latest.set(field, value);
    }
  }
  const out: SizeSuggestion[] = [];
  for (const [field, value] of latest) {
    const current = profile?.[field]?.trim() || undefined;
    if (current && sameSize(current, value)) continue;
    const key = `${who}|${field}|${value.trim().toLowerCase()}`;
    if (decided.has(key)) continue;
    out.push({ field, value, current, key });
  }
  return out;
}
