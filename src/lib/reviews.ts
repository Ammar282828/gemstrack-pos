/**
 * The house's reviews, as the link page shows them: the rating and count up top, a few real
 * quotes beneath (owner, 2026-10-01: "add google reviews at the top or side or make it
 * prominent somehow", for both link pages).
 *
 * Where they come from is the house's (STORE_REVIEWS_SOURCE, reviews-server.ts):
 *   google   Taheri: its Google Business listing ("Taheri Collections", 4.9 from 17 that day),
 *            read through Google's Places API — the listing's id is STORE_GOOGLE_PLACE.
 *   judgeme  House of Mina: she has no Google listing; her 138 reviews (4.81) are Judge.me's on
 *            houseofmina.store, read from the shop's metafields through the ERP's Shopify access.
 * Each house keeps the last reading in its own Firestore (`app_settings/reviews`), so the page
 * never waits on Google or Shopify, and a source that stops answering leaves the last good one.
 *
 * The page never says "Google" for reviews that aren't Google's, never shows a rating it didn't
 * read, and quotes reviewers' words as written (whitespace tidied, a lowercase first letter
 * raised — nothing else).
 *
 * Pure.
 */

export type ReviewsSource = 'google' | 'judgeme';

export interface ReviewQuote {
  author: string;
  stars: number;
  text: string;
  /** ISO date when the source gives one. */
  at?: string;
  /** The piece it is about (Judge.me reviews are per product). */
  about?: { name: string; url: string };
}

export interface ReviewsSnapshot {
  source: ReviewsSource;
  /** The listing's or shop's name as the source has it. */
  name: string;
  rating: number;
  count: number;
  /** Where every review can be read. */
  readUrl: string;
  /** Where a customer leaves one (Taheri's Google review link). */
  writeUrl?: string;
  /** The best few, already chosen. */
  quotes: ReviewQuote[];
  /** When it was read, ISO. */
  at: string;
  /** Google's own id for the place, once the Places API has found it. */
  placeId?: string;
}

/** "  i never take it off  " → "I never take it off". */
export function tidy(text: string): string {
  const t = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const QUOTE_MIN = 25;
const QUOTE_MAX = 240;

/**
 * The quotes worth showing: five stars (four when there are too few fives), words enough to say
 * something and few enough to read at a glance, one per reviewer and — where reviews are about
 * pieces — one per piece, the fullest first.
 */
export function pickQuotes(all: ReviewQuote[], n = 3): ReviewQuote[] {
  const usable = all
    .map((q) => ({ ...q, text: tidy(q.text) }))
    .filter((q) => q.text.length >= QUOTE_MIN && q.text.length <= QUOTE_MAX);
  const fives = usable.filter((q) => q.stars >= 5);
  const pool = fives.length >= n ? fives : usable.filter((q) => q.stars >= 4);
  const ranked = [...pool].sort((a, b) => b.stars - a.stars || b.text.length - a.text.length || (b.at ?? '').localeCompare(a.at ?? ''));
  const out: ReviewQuote[] = [];
  const authors = new Set<string>();
  const pieces = new Set<string>();
  for (const q of ranked) {
    const who = q.author.trim().toLowerCase();
    if (authors.has(who) || (q.about && pieces.has(q.about.name))) continue;
    authors.add(who);
    if (q.about) pieces.add(q.about.name);
    out.push(q);
    if (out.length === n) break;
  }
  return out;
}

/** 4.81 → "4.8"; 5 → "5.0". */
export const ratingLabel = (r: number) => (Math.round(r * 10) / 10).toFixed(1);

/** A Maps feature id ("0x…:0x…") → the place's cid, which Google's own links carry. */
export function cidOf(place: string): string | null {
  const hex = place.trim().match(/:(0x[0-9a-f]+)$/i)?.[1];
  if (hex) return BigInt(hex).toString();
  return /^\d{6,}$/.test(place.trim()) ? place.trim() : null;
}

/** The listing on Google Maps: its feature id's own place address (opened and checked 2026-10-01), else its cid. */
export const mapsUrl = (place: string) => {
  const p = place.trim();
  if (/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(p)) return `https://www.google.com/maps/place/data=!4m2!3m1!1s${p}`;
  const cid = cidOf(p);
  return cid ? `https://maps.google.com/?cid=${cid}` : '';
};

// ── Places API (New): places/{id} with rating,userRatingCount,reviews ──────────

interface PlacesReview {
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  publishTime?: string;
}
export interface PlacesDetails {
  id?: string;
  displayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: PlacesReview[];
}

export function fromPlaces(d: PlacesDetails, opts: { place: string; writeUrl?: string; at: string }): ReviewsSnapshot | null {
  if (typeof d.rating !== 'number' || typeof d.userRatingCount !== 'number' || d.userRatingCount < 1) return null;
  const quotes = (d.reviews ?? []).map((r) => ({
    author: r.authorAttribution?.displayName?.trim() || 'A customer',
    stars: Number(r.rating) || 0,
    text: r.originalText?.text || r.text?.text || '',
    at: r.publishTime,
  }));
  return {
    source: 'google',
    name: d.displayName?.text || '',
    rating: d.rating,
    count: d.userRatingCount,
    readUrl: d.googleMapsUri || mapsUrl(opts.place),
    writeUrl: opts.writeUrl || undefined,
    quotes: pickQuotes(quotes),
    at: opts.at,
    placeId: d.id,
  };
}

// ── Judge.me: the shop metafields judgeme.all_reviews_rating / _count / reviews_grid ──

interface JudgemeReview {
  rating?: number; body?: string; body_html?: string; reviewer_name?: string; created_at?: string;
  product_title?: string; product_url?: string; is_shop_review?: boolean;
}

export function fromJudgeme(
  m: { rating?: string | null; count?: string | null; grid?: string | null },
  opts: { shopUrl: string; name: string; at: string },
): ReviewsSnapshot | null {
  let grid: { average_rating?: string | number; number_of_reviews?: number; all_reviews?: { reviews?: JudgemeReview[] } } = {};
  try { grid = m.grid ? JSON.parse(m.grid) : {}; } catch { grid = {}; }
  const rating = Number(m.rating ?? grid.average_rating);
  const count = Number(m.count ?? grid.number_of_reviews);
  if (!(rating > 0) || !(count > 0)) return null;
  const shop = opts.shopUrl.replace(/\/+$/, '');
  const quotes = (grid.all_reviews?.reviews ?? []).map((r) => ({
    author: r.reviewer_name?.trim() || 'A customer',
    stars: Number(r.rating) || 0,
    text: r.body || r.body_html || '',
    at: r.created_at,
    about: r.product_title && r.product_url && !r.is_shop_review
      ? { name: r.product_title, url: /^https?:/.test(r.product_url) ? r.product_url : `${shop}${r.product_url.startsWith('/') ? '' : '/'}${r.product_url}` }
      : undefined,
  }));
  return { source: 'judgeme', name: opts.name, rating, count, readUrl: shop, quotes: pickQuotes(quotes), at: opts.at };
}
