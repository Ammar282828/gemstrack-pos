/**
 * Several photos of one piece with one description (the owner, 2026-10-23: "the hub should allow me to send
 * multiple pics of a product together with one description, 1 to as many as i want"). The parts that need no
 * server and no browser, so the Posts hub, the routes, the queue and the tests agree:
 *
 *   WhatsApp   the photos one after another to each place, the description under the first only — WAHA has no
 *              album call; WhatsApp gathers photos sent back to back into an album on the phone by itself
 *   Instagram  a carousel of up to ten (Instagram's own limit), the description as its one caption; more than
 *              ten are chosen → the first ten go and the page says so
 *   One-photo  places (the Instagram story, the website's weight) take the first photo
 *
 * One photo is exactly what was sent before: one image, its caption.
 */

/** Instagram's limit on a carousel's children. */
export const IG_CAROUSEL_MAX = 10;
/** Photos of one piece in one send — far more than a counter needs; the queue and the hub keep to it. */
export const ALBUM_MAX = 30;

/** The caption each photo carries: the description under the first, nothing under the rest. */
export function albumCaptions(caption: string, n: number): string[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => (i === 0 ? caption : ''));
}

/** "ruby-ring.jpg", "ruby-ring-2.jpg", … — the queue's own naming (queue.ts), so the send log reads the same. */
export function albumFileName(base: string, i: number, ext = 'jpg'): string {
  return `${base || 'piece'}${i ? `-${i + 1}` : ''}.${ext}`;
}

/** What a carousel takes from `n` photos: the first ten; `dropped` is how many are left out. 1 is a plain photo. */
export function carouselPlan(n: number, max = IG_CAROUSEL_MAX): { take: number; dropped: number; carousel: boolean } {
  const count = Math.max(0, Math.floor(n));
  const take = Math.min(count, max);
  return { take, dropped: count - take, carousel: take > 1 };
}

/** Instagram's feed shapes: 4:5 to 1.91:1. */
export const FEED_MIN_RATIO = 0.8;
export const FEED_MAX_RATIO = 1.91;

/**
 * The part of a `width` × `height` picture that fits Instagram's feed: the whole of it when its shape is already
 * between 4:5 and 1.91:1, else the middle cut to the nearest allowed shape (a phone's 3:4 portrait → 4:5).
 */
export function feedCrop(width: number, height: number): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const r = w / h;
  if (r < FEED_MIN_RATIO) {
    const ch = Math.min(h, Math.round(w / FEED_MIN_RATIO));
    return { left: 0, top: Math.floor((h - ch) / 2), width: w, height: ch };
  }
  if (r > FEED_MAX_RATIO) {
    const cw = Math.min(w, Math.round(h * FEED_MAX_RATIO));
    return { left: Math.floor((w - cw) / 2), top: 0, width: cw, height: h };
  }
  return { left: 0, top: 0, width: w, height: h };
}

/**
 * A WhatsApp caption as Instagram should show it: WhatsApp's *bold*, _italic_ and ~strike~ markers taken off
 * (Instagram prints them as they are). Links, emoji and line breaks stay.
 */
export function instagramText(caption: string): string {
  return caption
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/gm, '$1$2')
    .replace(/(^|[\s(])~([^~\n]+)~(?=[\s).,!?:;]|$)/gm, '$1$2')
    .trim();
}

/** "3 photos" / "1 photo". */
export const photosLabel = (n: number) => `${n} photo${n === 1 ? '' : 's'}`;

/**
 * Sending an album to several places, one photo at a time: which places photo `i` still goes to. A place that
 * failed an earlier photo is left out of the rest — its later photos would arrive without the first and its
 * description — as the queue does (queue.ts sendItem).
 */
export function placesFor(all: readonly string[], failed: ReadonlySet<string>): string[] {
  return all.filter(k => !failed.has(k));
}
