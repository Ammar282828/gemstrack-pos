/**
 * Post a Piece's queue, the parts that need no server: what a queued piece
 * sends, in what order, and when each piece goes when the counter spreads a
 * batch over the day. Pure, so the page, the server and the tests agree.
 */

/** A queued piece's status. `held` waits for the counter; `scheduled` goes at `dueAt`. */
export type QueueStatus = 'draft' | 'held' | 'scheduled' | 'sending' | 'sent' | 'failed';

/** Where a queued piece goes — decided on the page when it was queued. */
export interface QueueTargets {
  /** Its squares to the website, into `folder` ("Category/Collection"), one name per photo. */
  website: { folder: string; collection: string; names: string[]; featured: boolean } | null;
  /** Its story to Instagram. */
  instagram: boolean;
  /** Its squares to these WhatsApp destinations, by key (destinations.ts). */
  whatsapp: string[];
}

export interface QueueCounts { site: number; wa: number; story: boolean }

/**
 * Every single send a piece makes, in the order they go: the website photos,
 * the set of the day (it needs the first photo's place on the site), the
 * story, then each WhatsApp destination's squares in turn — so each group
 * gets its photos together, the caption on the first.
 */
export function queueUnits(t: QueueTargets, c: QueueCounts): string[] {
  const units: string[] = [];
  if (t.website && c.site > 0) {
    for (let i = 0; i < c.site; i++) units.push(`site-${i}`);
    if (t.website.featured) units.push('featured');
  }
  if (t.instagram && c.story) units.push('instagram');
  for (const key of t.whatsapp) for (let i = 0; i < c.wa; i++) units.push(`wa:${key}:${i}`);
  return units;
}

/** The stored images a piece needs before it can be queued. */
export function queueMediaKeys(t: QueueTargets, c: QueueCounts): string[] {
  return [
    ...(t.website ? Array.from({ length: c.site }, (_, i) => `site-${i}`) : []),
    ...(t.whatsapp.length ? Array.from({ length: c.wa }, (_, i) => `wa-${i}`) : []),
    ...(t.instagram && c.story ? ['story'] : []),
  ];
}

/**
 * Times for `n` pieces spread evenly from `from` to `to` (both included when
 * n > 1). A window already over, or backwards, puts them all at `from`.
 */
export function spreadTimes(n: number, from: Date, to: Date): Date[] {
  if (n <= 0) return [];
  const span = to.getTime() - from.getTime();
  if (n === 1 || span <= 0) return Array.from({ length: n }, () => new Date(from));
  const step = span / (n - 1);
  // To the minute: a time the counter reads as "4:35", not "4:35:17".
  return Array.from({ length: n }, (_, i) => new Date(Math.round((from.getTime() + step * i) / 60_000) * 60_000));
}

/**
 * The end of today's posting window, local time: half an hour before closing
 * (Sat–Thu 21:00, Friday 20:00 — the shop's hours).
 */
export function defaultSpreadEnd(now: Date): Date {
  const end = new Date(now);
  const friday = now.getDay() === 5;
  end.setHours(friday ? 19 : 20, 30, 0, 0);
  return end;
}
