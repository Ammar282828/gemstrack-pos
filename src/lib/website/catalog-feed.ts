/**
 * Every piece on the house's website as a Meta product feed (CSV), for the WhatsApp catalogue (owner, 2026-11-03:
 * "Set price as 0 for all products and make the catalogue"). Meta's catalogue requires a price on every item and the
 * house prices by the day's rate, so each piece carries 0 and its description says to ask for today's price. Meta
 * re-reads the feed daily (app/api/public/catalog-feed), so a new piece joins and a sold or hidden one leaves.
 * Only what the website already shows publicly.
 */

import { createHash } from 'crypto';
import type { SitePiece } from '@/lib/website/site-pieces';

const COLUMNS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'additional_image_link', 'brand', 'product_type'] as const;

/** Meta's id: at most 100 characters and stable; the site's key is a photograph's path, so a short hash of it. */
export const feedId = (siteId: string) => createHash('sha1').update(siteId).digest('hex').slice(0, 24);

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const clean = (s: string | undefined | null) => String(s || '').replace(/\s+/g, ' ').trim();

export function feedRow(p: SitePiece, brand: string, currency = 'PKR'): Record<(typeof COLUMNS)[number], string> {
  const facts = (p.facts || []).map(clean).filter(f => f && !/^none$/i.test(f));
  const weight = p.weightGrams && p.weightGrams > 0 ? `${Number(p.weightGrams.toFixed(2))} g` : '';
  const details = [weight, ...facts].filter(Boolean).join(' · ');
  const description = [clean(p.about), details && `${details}.`, 'Message us for today\'s price.'].filter(Boolean).join(' ');
  return {
    id: feedId(p.id),
    title: clean(p.name).slice(0, 200) || 'Piece',
    description: description.slice(0, 9999),
    availability: 'in stock',
    condition: 'new',
    price: `0.00 ${currency}`,
    link: p.url,
    image_link: p.image,
    additional_image_link: (p.photos || []).slice(0, 10).map(x => x.image).join(','),
    brand,
    product_type: clean(p.collection),
  };
}

/** The feed: a header and one line per piece shown on the site (not hidden, with a page and a photograph). */
export function catalogFeedCsv(pieces: SitePiece[], brand: string): string {
  const rows = pieces.filter(p => p.url && p.image && !p.hidden).map(p => feedRow(p, brand));
  const seen = new Set<string>();
  const unique = rows.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return [COLUMNS.join(','), ...unique.map(r => COLUMNS.map(c => cell(r[c])).join(','))].join('\n') + '\n';
}
