/**
 * The price book: every piece on taheri.shop at today's rate, in one answer a CDN can keep.
 *
 * Built for a crowd (the owner, 2026-10-04: "make sure my site can handle 100s of users at a time").
 * Before, each visitor's page asked POST /api/public/quote for its pieces, and every ask did a
 * Firestore rate-limit transaction and two settings reads on the ERP's own server — the one the
 * counter works on. Prices change only when the shop sets its rate or its making, so one book,
 * computed here at most once a minute per instance and cached at Google's edge for two minutes
 * (GET /api/public/prices), serves any number of visitors: the ERP sees a request every couple of
 * minutes however many people are browsing. A new price reaches the site within ~3 minutes of the
 * rate being set; the checkout re-prices on the server regardless (checkout.ts), so a book a minute
 * old can never sell at yesterday's rate.
 *
 * Each entry is [price | null, reason | null, weightGrams | null, weightSource | null] — the same four
 * things a quote carries, without the key repeated.
 */

import { configReadiness, loadRates, loadWebsiteConfig, ratesUsable } from './config';
import { getCatalogAttributes } from './catalog-source';
import { quotePiece } from './pricing';
import { getPosWeights, mergeWeights } from './weights';
import type { QuoteRates } from './pricing';
import type { WebsiteConfig } from './types';

export type BookEntry = [number | null, string | null, number | null, string | null];

export interface PriceBook {
  selling: boolean;
  currency: string;
  ratesAt: string;
  ratesUpdatedAt: string | null;
  deliveryCharge: number;
  freeDeliveryOver: number | null;
  builtAt: string;
  prices: Record<string, BookEntry>;
}

/** What a quote needs, read once for many requests: a short memory, so a burst costs two reads, not two per caller. */
const INPUTS_MS = 30_000;
let inputs: { at: number; value: Promise<{ config: WebsiteConfig; rates: QuoteRates & { updatedAt: string | null } }> } | null = null;
export function quoteInputs(): Promise<{ config: WebsiteConfig; rates: QuoteRates & { updatedAt: string | null } }> {
  if (inputs && Date.now() - inputs.at < INPUTS_MS) return inputs.value;
  const value = Promise.all([loadWebsiteConfig(), loadRates()]).then(([config, rates]) => ({ config, rates }));
  inputs = { at: Date.now(), value };
  value.catch(() => { if (inputs?.value === value) inputs = null; });
  return value;
}

export function isSelling(config: WebsiteConfig, rates: QuoteRates): boolean {
  // The same test checkout applies: a price the site shows must be one it can take an order at.
  return config.enabled && ratesUsable(rates) && configReadiness(config).ready;
}

const BOOK_MS = 60_000;
let book: { at: number; value: Promise<PriceBook> } | null = null;

export function priceBook(): Promise<PriceBook> {
  if (book && Date.now() - book.at < BOOK_MS) return book.value;
  const value = build();
  book = { at: Date.now(), value };
  value.catch(() => { if (book?.value === value) book = null; });
  return value;
}

async function build(): Promise<PriceBook> {
  const [{ config, rates }, published, pos] = await Promise.all([quoteInputs(), getCatalogAttributes(), getPosWeights()]);
  const catalog = mergeWeights(published, pos);
  const selling = isSelling(config, rates);
  const priced = selling ? config : { ...config, enabled: false };
  const prices: Record<string, BookEntry> = {};
  for (const [key, attrs] of Object.entries(catalog)) {
    const q = quotePiece(key, attrs, priced, rates);
    prices[key] = [q.priceable && typeof q.price === 'number' ? Math.round(q.price) : null, q.priceable ? null : q.reason ?? null, attrs?.weightGrams ?? null, attrs?.weightSource ?? null];
  }
  return {
    selling,
    currency: config.currency,
    ratesAt: rates.updatedAt ?? new Date().toISOString(),
    ratesUpdatedAt: rates.updatedAt,
    deliveryCharge: config.deliveryCharge,
    freeDeliveryOver: config.freeDeliveryOver ?? null,
    builtAt: new Date().toISOString(),
    prices,
  };
}
