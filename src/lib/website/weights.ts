/**
 * Weights recorded at the counter for catalogue photographs.
 *
 * Most photographs carry the piece's weight burned into the corner, and the
 * site's tagger read it from there. About half do not. This is where the
 * shop records those — one document per photograph in `website_pieces` — and
 * the site draws the number onto the photo the way the burned-in ones look.
 *
 * A recorded weight also wins for pricing: a person with the piece on the
 * scale beats a model reading a label.
 */

import { adminDb } from '@/lib/firebase-admin';
import type { PieceAttrs } from './types';

export const PIECES = 'website_pieces';

export interface PosWeight {
  key: string;
  weightGrams: number;
  enteredBy: string;
  enteredAt: string;
}

/** Piece keys carry slashes and spaces; a document id may not. Reversible. */
export const docIdFor = (key: string) => Buffer.from(key, 'utf8').toString('base64url');
export const keyFromDocId = (id: string) => Buffer.from(id, 'base64url').toString('utf8');

const TTL_MS = 60 * 1000;
let cache: { at: number; byKey: Record<string, PosWeight> } | null = null;

export async function getPosWeights(fresh = false): Promise<Record<string, PosWeight>> {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.byKey;
  const snap = await adminDb.collection(PIECES).get();
  const byKey: Record<string, PosWeight> = {};
  for (const d of snap.docs) {
    const w = d.data() as Partial<PosWeight>;
    if (typeof w.weightGrams === 'number' && w.weightGrams > 0 && w.key) byKey[w.key] = w as PosWeight;
  }
  cache = { at: Date.now(), byKey };
  return byKey;
}

export async function setPosWeight(key: string, weightGrams: number | null, by: string): Promise<void> {
  const ref = adminDb.collection(PIECES).doc(docIdFor(key));
  if (!weightGrams || weightGrams <= 0) await ref.delete();
  else await ref.set({ key, weightGrams: Math.round(weightGrams * 100) / 100, enteredBy: by, enteredAt: new Date().toISOString() });
  cache = null;
}

export type WeightSource = 'label' | 'pos' | null;

export interface PieceWithWeight extends PieceAttrs {
  /** Where the weight the site shows came from: read off the photo, or typed at the counter. */
  weightSource: WeightSource;
  /** What the tagger read, kept even when the counter overrides it. */
  labelWeightGrams?: number;
}

/**
 * The catalogue with counter weights folded in. A counter weight replaces the
 * label's for pricing; `weightSource` tells the site whether to draw it.
 */
export function mergeWeights(catalog: Record<string, PieceAttrs>, pos: Record<string, PosWeight>): Record<string, PieceWithWeight> {
  const out: Record<string, PieceWithWeight> = {};
  for (const [key, attrs] of Object.entries(catalog)) {
    const label = typeof attrs.weightGrams === 'number' && attrs.weightGrams > 0 ? attrs.weightGrams : undefined;
    const counter = pos[key]?.weightGrams;
    out[key] = {
      ...attrs,
      weightGrams: counter ?? label,
      // The label is what the photo already shows; drawing it again would double it.
      weightSource: label ? 'label' : counter ? 'pos' : null,
      labelWeightGrams: label,
    };
  }
  return out;
}
