/**
 * The counter's weights as the website reads them: per piece, not per photograph — a weight entered on
 * one of a piece's extra angles is the piece's (weights.ts withAngleWeights, from the site's own
 * `angleOf`). For the price book, quotes, checkout and the ERP's list of site pieces; the Photo Weights
 * page keeps showing what was entered on each photograph (getPosWeights).
 */

import { getPosCarats, getPosWeights, withAngleCarats, withAngleWeights, type PosWeight } from './weights';
import { getSiteOverrides } from './site-edits';

const site = () => (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');

export async function getPieceWeights(fresh = false): Promise<Record<string, PosWeight>> {
  const [pos, overrides] = await Promise.all([getPosWeights(fresh), getSiteOverrides(site()).catch(() => ({}))]);
  return withAngleWeights(pos, overrides);
}

/** The counter's diamond carats, per piece (an angle's carats are its lead's), for the price book. */
export async function getPieceCarats(fresh = false): Promise<Record<string, number>> {
  const [carats, overrides] = await Promise.all([getPosCarats(fresh), getSiteOverrides(site()).catch(() => ({}))]);
  return withAngleCarats(carats, overrides);
}
