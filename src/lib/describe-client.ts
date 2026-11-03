/**
 * The browser's side of /api/app/describe and /api/app/catalogue: one read each, kept in memory
 * (descriptions five minutes, the catalogue ten), and the write that saves a stone combination.
 */

import { authedFetch } from '@/lib/voice/authed-fetch';
import { cleanCombos, type DescribeEntry } from '@/lib/describe';

export interface DescribeData { history: DescribeEntry[]; combos: string[] }
export interface CataloguePiece { id: string; title: string; category: string; image: string; thumb: string; /** ring, bangle, earrings, … or `other` (older servers send none). */ type?: string; /** diamond, ruby, … */ stones?: string[] }

const DESCRIBE_TTL = 5 * 60_000;
const CATALOGUE_TTL = 10 * 60_000;
let described: { at: number; data: DescribeData; pending?: Promise<DescribeData> } | null = null;
const catalogues = new Map<string, { at: number; pieces: CataloguePiece[]; pending?: Promise<CataloguePiece[]> }>();

/** The description history (all categories) and the saved combinations; the last known on a failed read. */
export function loadDescribe(force = false): Promise<DescribeData> {
  if (!force && described && Date.now() - described.at < DESCRIBE_TTL) return Promise.resolve(described.data);
  if (described?.pending) return described.pending;
  const prior = described?.data ?? { history: [], combos: [] };
  const pending = authedFetch('/api/app/describe')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('describe'))))
    .then((d: Partial<DescribeData>) => {
      const data = { history: Array.isArray(d.history) ? d.history : [], combos: Array.isArray(d.combos) ? d.combos : [] };
      described = { at: Date.now(), data };
      return data;
    })
    .catch(() => { described = { at: Date.now() - DESCRIBE_TTL + 30_000, data: prior }; return prior; });
  described = { at: described?.at ?? 0, data: prior, pending };
  return pending;
}

/**
 * The website's pieces of one category (an ERP item category; every category when empty), each with its `type` and
 * `stones`. The picker filters by type, stone and words on the device, so this is asked again only when the category changes.
 */
export function loadCatalogue(category = ''): Promise<CataloguePiece[]> {
  const key = category;
  const hit = catalogues.get(key);
  if (hit && !hit.pending && Date.now() - hit.at < CATALOGUE_TTL) return Promise.resolve(hit.pieces);
  if (hit?.pending) return hit.pending;
  const prior = hit?.pieces ?? [];
  const url = category ? `/api/app/catalogue?category=${encodeURIComponent(category)}` : '/api/app/catalogue';
  const pending = authedFetch(url)
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('catalogue'))))
    .then((d: { pieces?: CataloguePiece[] }) => {
      const pieces = Array.isArray(d.pieces) ? d.pieces : [];
      catalogues.set(key, { at: Date.now(), pieces });
      return pieces;
    })
    .catch(() => { catalogues.set(key, { at: Date.now() - CATALOGUE_TTL + 30_000, pieces: prior }); return prior; });
  catalogues.set(key, { at: hit?.at ?? 0, pieces: prior, pending });
  return pending;
}

/** Saves the combinations (replacing the list kept); resolves to the list as the server kept it. */
export async function saveStoneCombos(combos: string[]): Promise<string[]> {
  const clean = cleanCombos(combos);
  if (!clean.ok) throw new Error(clean.error);
  const res = await authedFetch('/api/app/write', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'setStoneCombos', combos: clean.combos }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save the combination.');
  const kept: string[] = Array.isArray(data.combos) ? data.combos : clean.combos;
  if (described) described = { ...described, data: { ...described.data, combos: kept } };
  return kept;
}
