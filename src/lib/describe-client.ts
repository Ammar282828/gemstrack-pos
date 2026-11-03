/**
 * The browser's side of /api/app/describe and /api/app/catalogue: one read each, kept in memory
 * (descriptions five minutes, the catalogue ten), and the write that saves a stone combination.
 */

import { authedFetch } from '@/lib/voice/authed-fetch';
import { cleanCombos, type DescribeEntry } from '@/lib/describe';

export interface DescribeData { history: DescribeEntry[]; combos: string[] }
export interface CataloguePiece { id: string; title: string; category: string; image: string; thumb: string }

const DESCRIBE_TTL = 5 * 60_000;
const CATALOGUE_TTL = 10 * 60_000;
let described: { at: number; data: DescribeData; pending?: Promise<DescribeData> } | null = null;
let catalogue: { at: number; pieces: CataloguePiece[]; pending?: Promise<CataloguePiece[]> } | null = null;

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

/** The website's pieces, every category (the picker filters by category and words on the device). */
export function loadCatalogue(): Promise<CataloguePiece[]> {
  if (catalogue && !catalogue.pending && Date.now() - catalogue.at < CATALOGUE_TTL) return Promise.resolve(catalogue.pieces);
  if (catalogue?.pending) return catalogue.pending;
  const prior = catalogue?.pieces ?? [];
  const pending = authedFetch('/api/app/catalogue')
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('catalogue'))))
    .then((d: { pieces?: CataloguePiece[] }) => {
      const pieces = Array.isArray(d.pieces) ? d.pieces : [];
      catalogue = { at: Date.now(), pieces };
      return pieces;
    })
    .catch(() => { catalogue = { at: Date.now() - CATALOGUE_TTL + 30_000, pieces: prior }; return prior; });
  catalogue = { at: catalogue?.at ?? 0, pieces: prior, pending };
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
