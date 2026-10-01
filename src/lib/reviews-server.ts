/**
 * Reading and refreshing the house's reviews (lib/reviews.ts says what and why).
 *
 * `getReviews()` is the link page's: the last reading from `app_settings/reviews`, kept ten
 * minutes per instance, never more than a second and a half of the page's time.
 * `refreshReviews()` rides the five-minute `social-queue-tick` in both houses and reads the
 * source again at most every six hours — a failure is written down (`lastError`) and leaves the
 * last good reading in place.
 *
 *   STORE_REVIEWS_SOURCE  google | judgeme | none. Unset: google when STORE_GOOGLE_PLACE is set.
 *   STORE_GOOGLE_PLACE    the listing's Maps feature id ("0x…:0x…") or cid — Taheri's file.
 *
 * Google is read with the server's own identity (no key): it needs the Places API (New) enabled
 * in the house's project — not yet on 2026-10-01, when Taheri's reading was taken by hand from
 * the public listing. Judge.me is read through the ERP's Shopify Admin access (House of Mina).
 *
 * Server-only.
 */

import { GoogleAuth } from 'google-auth-library';
import { adminDb } from '@/lib/firebase-admin';
import { STORE_CONFIG, STORE_LINKS } from '@/lib/store-config';
import { cidOf, fromJudgeme, fromPlaces, type PlacesDetails, type ReviewsSnapshot, type ReviewsSource } from '@/lib/reviews';

const DOC = () => adminDb.collection('app_settings').doc('reviews');
const FRESH_MS = 6 * 3_600_000;
const CACHE_MS = 10 * 60_000;

const PLACE = process.env.STORE_GOOGLE_PLACE?.trim() || '';
export function reviewsSource(): ReviewsSource | null {
  const s = process.env.STORE_REVIEWS_SOURCE?.trim().toLowerCase();
  if (s === 'google' || s === 'judgeme') return s;
  if (s === 'none') return null;
  return PLACE ? 'google' : null;
}

interface Stored { snapshot?: ReviewsSnapshot; triedAt?: string; lastError?: string | null }

let cache: { at: number; snap: ReviewsSnapshot | null } | null = null;

/** The last reading, or null (no source, nothing read yet, or Firestore slower than the page can wait). */
export async function getReviews(): Promise<ReviewsSnapshot | null> {
  if (!reviewsSource()) return null;
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.snap;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 1500); });
    const read = DOC().get().then((d) => ((d.data() as Stored | undefined)?.snapshot ?? null));
    const snap = await Promise.race([read, slow]);
    if (snap !== null) cache = { at: Date.now(), snap };
    return snap;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Save a reading (the refresher, or a reading taken by hand). */
export async function saveReviews(snapshot: ReviewsSnapshot): Promise<void> {
  await DOC().set({ snapshot, triedAt: new Date().toISOString(), lastError: null }, { merge: true });
  cache = { at: Date.now(), snap: snapshot };
}

// ── Google: Places API (New) ───────────────────────────────────────────────

const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const PLACES = 'https://places.googleapis.com/v1';

async function places<T>(path: string, init: { method?: string; body?: unknown; fields: string }): Promise<T> {
  const token = (await (await gauth.getClient()).getAccessToken()).token;
  const res = await fetch(`${PLACES}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Goog-FieldMask': init.fields },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Places API ${res.status}: ${String(data.error?.message || '').slice(0, 200)}`);
  return data;
}

/** Google's id for the listing: found once by name, and only accepted if it is the same listing (its cid). */
async function placeId(prev: ReviewsSnapshot | undefined): Promise<string> {
  if (prev?.placeId) return prev.placeId;
  const cid = cidOf(PLACE);
  if (!cid) throw new Error('STORE_GOOGLE_PLACE is not a Maps feature id or cid.');
  const query = `${prev?.name || STORE_CONFIG.name} Karachi`;
  const found = await places<{ places?: { id: string; googleMapsUri?: string }[] }>('/places:searchText', {
    method: 'POST', body: { textQuery: query, languageCode: 'en' }, fields: 'places.id,places.googleMapsUri',
  });
  const hit = found.places?.find((p) => p.googleMapsUri?.includes(`cid=${cid}`));
  if (!hit) throw new Error(`No listing with cid ${cid} for “${query}”.`);
  return hit.id;
}

async function readGoogle(prev: ReviewsSnapshot | undefined): Promise<ReviewsSnapshot> {
  const id = await placeId(prev);
  const d = await places<PlacesDetails>(`/places/${encodeURIComponent(id)}?languageCode=en`, {
    fields: 'id,displayName,rating,userRatingCount,googleMapsUri,reviews',
  });
  const snap = fromPlaces(d, { place: PLACE, writeUrl: STORE_LINKS.googleReview, at: new Date().toISOString() });
  if (!snap) throw new Error('The listing came back with no rating.');
  // Places returns five reviews at most: keep the hand-read quotes when it gives fewer worth showing.
  if (snap.quotes.length < 2 && prev?.quotes?.length) snap.quotes = prev.quotes;
  return snap;
}

// ── Judge.me through Shopify ───────────────────────────────────────────────

async function readJudgeme(): Promise<ReviewsSnapshot> {
  const shop = process.env.SHOPIFY_STORE_DOMAIN?.trim();
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  if (!shop || !token) throw new Error('No Shopify access (SHOPIFY_STORE_DOMAIN / SHOPIFY_ACCESS_TOKEN).');
  const { shopifyGraphQL } = await import('@/app/api/shopify/_lib');
  const d = await shopifyGraphQL(shop, token, `{ shop {
    name
    rating: metafield(namespace: "judgeme", key: "all_reviews_rating") { value }
    count: metafield(namespace: "judgeme", key: "all_reviews_count") { value }
    grid: metafield(namespace: "judgeme", key: "reviews_grid") { value }
  } }`) as { shop: { name: string; rating?: { value: string } | null; count?: { value: string } | null; grid?: { value: string } | null } };
  const snap = fromJudgeme(
    { rating: d.shop.rating?.value, count: d.shop.count?.value, grid: d.shop.grid?.value },
    { shopUrl: STORE_LINKS.shop || `https://${shop}`, name: d.shop.name, at: new Date().toISOString() },
  );
  if (!snap) throw new Error('Judge.me has no rating for the shop.');
  return snap;
}

/** Read the source again when the last try is over six hours old. Never throws. */
export async function refreshReviews(opts: { force?: boolean } = {}): Promise<{ status: 'fresh' | 'read' | 'failed' | 'off'; error?: string }> {
  const source = reviewsSource();
  if (!source) return { status: 'off' };
  try {
    const stored = ((await DOC().get()).data() ?? {}) as Stored;
    if (!opts.force && stored.triedAt && Date.now() - Date.parse(stored.triedAt) < FRESH_MS) return { status: 'fresh' };
    try {
      const snap = source === 'google' ? await readGoogle(stored.snapshot) : await readJudgeme();
      await saveReviews(snap);
      return { status: 'read' };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await DOC().set({ triedAt: new Date().toISOString(), lastError: error }, { merge: true });
      return { status: 'failed', error };
    }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}
