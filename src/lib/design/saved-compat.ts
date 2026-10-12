/**
 * Saved ads seen as designs, without a migration (plan §5.5): a legacy `ad_saved` row reads through as a
 * design with id `saved:<id>`, kind 'ad', scope 'ads', one page; the first Save writes a `designs` record
 * that names it in `legacy.savedAdId`, and from then on the old row is hidden. Pure, tested.
 */

import { AD_FORMATS, customFormat } from '@/lib/ads/studio/templates';
import type { SavedAd, SavedKey } from '@/lib/ads/studio/saved';
import { fileKey, type DesignRecord } from './model';

export const SAVED_PREFIX = 'saved:';
export const isLegacyId = (id: string) => id.startsWith(SAVED_PREFIX);
export const legacyId = (id: string) => id.slice(SAVED_PREFIX.length);
/** The one page a legacy ad has. */
export const LEGACY_PAGE = 'main';

/** A legacy file name and the design file key it answers to ('image' → 'image:main'). */
export const legacyKeyOf = (key: string): SavedKey | null => {
  const [type, page] = key.split(':');
  return page === LEGACY_PAGE && (type === 'image' || type === 'photo' || type === 'doc') ? type : null;
};

export function fromSaved(s: SavedAd): DesignRecord {
  const info = s.format === 'custom' ? customFormat(1, 1) : AD_FORMATS[s.format];
  const f = s.fields ?? {};
  const files: Record<string, number> = {};
  for (const [k, n] of Object.entries(s.parts ?? {})) if (n) files[fileKey(k as SavedKey, LEGACY_PAGE)] = n;
  return {
    id: SAVED_PREFIX + s.id,
    name: s.name,
    folder: s.folder ?? null,
    kind: 'ad',
    scope: 'ads',
    ...(s.asset?.id ? { source: { assetId: s.asset.id } } : {}),
    fields: { kicker: f.kicker ?? '', headline: f.headline ?? '', weight: f.weight ?? '', details: f.details ?? '' },
    copy: { price: s.price, adText: s.text, adHeadline: s.headline, goal: s.goal, link: s.link },
    pages: [{ id: LEGACY_PAGE, label: info.short, format: s.format, frame: info.frame, origin: 'master', rev: 0 }],
    master: LEGACY_PAGE,
    files,
    thumb: s.thumb ?? '',
    published: [],
    legacy: { savedAdId: s.id },
    at: s.at,
    updated: s.updated,
    by: s.by,
    rev: 0,
  };
}

/** Designs and the legacy ads beside them, newest first; a legacy ad that a design has superseded is hidden. */
export function mergeDesigns(designs: DesignRecord[], saved: SavedAd[]): DesignRecord[] {
  const superseded = new Set(designs.map(d => d.legacy?.savedAdId).filter((x): x is string => !!x));
  return [...designs, ...saved.filter(s => !superseded.has(s.id)).map(fromSaved)].sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0));
}
