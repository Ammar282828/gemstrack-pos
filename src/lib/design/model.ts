/**
 * The Design area's records (docs/features/design-studio-plan.md §5.5): one `designs` collection for
 * everything made in the designer — a piece's story and post, an ad, a WhatsApp square — as a set of pages
 * (the master and its resized copies). Types, and the one cleaner a save passes through (the page's word is
 * never trusted as-is). Pure; no database here (store.ts has it).
 */

import type { Fields } from '@/lib/social/editor';
import type { Frame } from '@/lib/social/story';
import { GOALS, type GoalKey } from '@/lib/ads/plan';
import { isAdFormat, type AdFormat } from '@/lib/ads/studio/templates';

export const DESIGN_KINDS = ['piece', 'ad', 'story', 'post', 'whatsapp', 'site', 'custom'] as const;
export type DesignKind = (typeof DESIGN_KINDS)[number];
/** 'shop' = anyone who may post; 'ads' = owner and marketing only (the ad studio's rule). */
export type DesignScope = 'shop' | 'ads';
export type PageOrigin = 'master' | 'resized' | 'manual';

export interface DesignPage {
  id: string;
  label: string;
  format: AdFormat;
  frame: Frame;
  origin: PageOrigin;
  /** The page a resized one was made from. */
  syncedFrom?: string;
  rev: number;
}

export interface DesignCopy { price?: string; wa?: string; ig?: string; adText?: string; adHeadline?: string; goal?: GoalKey; link?: string }
export interface DesignSource { siteId?: string; productId?: string; assetId?: string }
export interface PublishEntry { at: string; by: string; dest: string; ok: boolean; ref?: string }

export interface DesignRecord {
  id: string;
  name: string;
  /** A folder of `ad_folders`, shared with Saved ads. */
  folder: string | null;
  kind: DesignKind;
  scope: DesignScope;
  source?: DesignSource;
  fields: Fields;
  copy: DesignCopy;
  pages: DesignPage[];
  master: string;
  /** 'doc:<pageId>' | 'image:<pageId>' | 'photo:<photoId>' → how many 900 KB parts the file has. */
  files: Record<string, number>;
  /** A 200-px JPEG as a data URL, for the grid. */
  thumb: string;
  /** The last 20 sends. */
  published: PublishEntry[];
  legacy?: { savedAdId?: string; boardFrameId?: string; draftId?: string };
  at: string;
  updated: string;
  by: string;
  rev: number;
}

/** What a save carries; the server adds id, files, published, legacy, dates, by and rev. */
export type DesignInput = Pick<DesignRecord, 'name' | 'folder' | 'kind' | 'scope' | 'source' | 'fields' | 'copy' | 'pages' | 'master' | 'thumb'>;

/** A file of a design: 'doc:<pageId>', 'image:<pageId>' or 'photo:<photoId>'. */
export const FILE_KEY = /^(doc|image|photo):[\w-]{1,40}$/;
export const ID_OK = /^[\w-]{1,40}$/;
/** A design's id in the URL: its own, or a legacy saved ad's (`saved:<id>`). */
export const DESIGN_ID = /^(saved:)?[\w-]{1,40}$/;
export const fileKey = (type: 'doc' | 'image' | 'photo', id: string) => `${type}:${id}`;

/** Where the publish sheet's rows send a picture (plan §5.3); WP5 builds the rows from these. */
export type DestinationId = 'website' | 'featured' | 'whatsapp' | 'channel' | 'instagram-story' | 'instagram-post' | 'meta-ad' | 'site-replace';
export interface DestinationNeeds { ratio: '1:1' | '9:16' | 'any'; maxPx: number; caption: 'wa' | 'ig' | 'ad' | null }
export interface DestinationRow { id: DestinationId; label: string; available: boolean; /** Why not, in words the page can show. */ reason?: string; needs: DestinationNeeds }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const FIELD_KEYS = ['kicker', 'headline', 'weight', 'details'] as const;
const frameNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);

/** A save's words and settings, cleaned; null when it isn't a design. */
export function designInput(raw: unknown): DesignInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const kind = DESIGN_KINDS.find(k => k === r.kind);
  if (!kind || !Array.isArray(r.pages) || !r.pages.length || r.pages.length > 24) return null;
  const pages: DesignPage[] = [];
  for (const p of r.pages as Record<string, unknown>[]) {
    if (!p || typeof p !== 'object') return null;
    const fr = (p.frame ?? {}) as Partial<Frame>;
    const w = frameNum(fr.w), h = frameNum(fr.h);
    const origin = p.origin === 'resized' || p.origin === 'manual' || p.origin === 'master' ? p.origin : null;
    if (typeof p.id !== 'string' || !ID_OK.test(p.id) || pages.some(x => x.id === p.id) || !isAdFormat(p.format) || !origin) return null;
    if (!(w >= 100 && w <= 10_000 && h >= 100 && h <= 10_000)) return null;
    pages.push({
      id: p.id, label: str(p.label, 60), format: p.format, frame: { w, h }, origin,
      ...(typeof p.syncedFrom === 'string' && ID_OK.test(p.syncedFrom) ? { syncedFrom: p.syncedFrom } : {}),
      rev: typeof p.rev === 'number' && Number.isFinite(p.rev) ? Math.max(0, Math.round(p.rev)) : 0,
    });
  }
  const master = str(r.master, 40);
  if (!pages.some(p => p.id === master)) return null;
  const f = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<string, unknown>;
  const fields = Object.fromEntries(FIELD_KEYS.map(k => [k, str(f[k], 300)])) as Fields;
  const c = (r.copy && typeof r.copy === 'object' ? r.copy : {}) as Record<string, unknown>;
  const copy: DesignCopy = {};
  for (const [k, max] of [['price', 40], ['wa', 2000], ['ig', 2200], ['adText', 2000], ['adHeadline', 200], ['link', 500]] as const) if (typeof c[k] === 'string') copy[k] = (c[k] as string).slice(0, max);
  if (GOALS.some(g => g.key === c.goal)) copy.goal = c.goal as GoalKey;
  const s = r.source as Record<string, unknown> | null | undefined;
  const source: DesignSource = {};
  if (s && typeof s === 'object') for (const k of ['siteId', 'productId', 'assetId'] as const) if (typeof s[k] === 'string' && s[k]) source[k] = (s[k] as string).slice(0, 300);
  const thumb = str(r.thumb, 60_000);
  return {
    name: str(r.name, 120).trim() || 'Untitled design',
    folder: typeof r.folder === 'string' && ID_OK.test(r.folder) ? r.folder : null,
    kind,
    // Anything for the ad account stays owners' and marketing's: an ad is 'ads' whatever the page says.
    scope: r.scope === 'ads' || kind === 'ad' ? 'ads' : 'shop',
    ...(Object.keys(source).length ? { source } : {}),
    fields, copy, pages, master,
    thumb: /^data:image\/jpeg;base64,[\w+/=]+$/.test(thumb) ? thumb : '',
  };
}
