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
/**
 * A weight entered on any photograph of a piece is the piece's. Edit a piece lists every photograph,
 * the extra angles too (taheri.shop's `angleOf`), and a weight typed on an angle was stored under the
 * angle — while the site shows a piece's weight from its lead photograph, so it never appeared (the
 * owner weighed five angles on 2026-10-05). The lead takes its angles' weight, the latest entered,
 * unless it has its own.
 */
export function withAngleWeights(pos: Record<string, PosWeight>, overrides: Record<string, { angleOf?: unknown }>): Record<string, PosWeight> {
  const out: Record<string, PosWeight> = { ...pos };
  for (const [key, w] of Object.entries(pos)) {
    const lead = overrides[key]?.angleOf;
    if (typeof lead !== 'string' || !lead || lead === key || pos[lead]) continue;
    const had = out[lead];
    if (!had || String(had.enteredAt) < String(w.enteredAt)) out[lead] = { ...w, key: lead };
  }
  return out;
}

/**
 * Counter weights for photographs the published catalogue doesn't hold yet: the drops added from the
 * ERP (Add Photos, Post a piece) that the site folds in at run time until its next rebuild. Their weight
 * still has to reach the site — it draws it on the photo and shows it on the page — but with no metal,
 * karat or stone recorded they are never priced (the book carries them as weight only).
 */
export function posOnlyWeights(catalog: Record<string, PieceAttrs>, pos: Record<string, PosWeight>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, w] of Object.entries(pos)) if (!catalog[key] && w.weightGrams > 0) out[key] = w.weightGrams;
  return out;
}

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
