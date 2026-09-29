/**
 * Saved ads, without the database: what a save may carry (the page's word is never trusted as-is), and how
 * the Saved tab files and finds them. Pure, tested.
 */

import { AD_FORMATS, type AdFormat, type AdTemplateId } from './templates';
import { GOALS, type GoalKey } from '@/lib/ads/plan';
import type { SavedAd, SavedInput } from './saved';

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The words and settings of a save, cleaned; null when it isn't one. */
export function savedInput(raw: unknown): SavedInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const format = str(r.format, 20) as AdFormat;
  if (!(format in AD_FORMATS)) return null;
  const goal = (GOALS.some(g => g.key === r.goal) ? r.goal : 'whatsapp') as GoalKey;
  const fields: Record<string, string> = {};
  if (r.fields && typeof r.fields === 'object') for (const [k, v] of Object.entries(r.fields as Record<string, unknown>).slice(0, 12)) if (typeof v === 'string') fields[k.slice(0, 20)] = v.slice(0, 300);
  const a = r.asset as { id?: unknown; name?: unknown } | null | undefined;
  const thumb = str(r.thumb, 60_000);
  return {
    folder: typeof r.folder === 'string' && /^[\w-]{1,40}$/.test(r.folder) ? r.folder : null,
    name: str(r.name, 120).trim() || 'Untitled ad',
    format,
    template: (str(r.template, 30) || 'headline') as AdTemplateId,
    fields,
    price: str(r.price, 40),
    text: str(r.text, 2000),
    headline: str(r.headline, 200),
    goal,
    link: str(r.link, 500),
    asset: a && typeof a.id === 'string' && /^(site|drive|source):/.test(a.id) ? { id: a.id.slice(0, 300), name: str(a.name, 200) } : null,
    thumb: /^data:image\/jpeg;base64,[\w+/=]+$/.test(thumb) ? thumb : '',
  };
}

export type FolderView = 'all' | 'unfiled' | string;

/** How many saved ads each folder holds ('' = unfiled). */
export function folderCounts(items: Pick<SavedAd, 'folder'>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.folder ?? ''] = (out[i.folder ?? ''] ?? 0) + 1;
  return out;
}

/** The ads a folder shows, matching every word typed (name, words, headline), newest first as stored. */
export function inFolder<T extends Pick<SavedAd, 'folder' | 'name' | 'text' | 'headline'>>(items: T[], view: FolderView, q = ''): T[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(i =>
    (view === 'all' || (view === 'unfiled' ? !i.folder : i.folder === view))
    && words.every(w => `${i.name} ${i.headline} ${i.text}`.toLowerCase().includes(w)));
}
