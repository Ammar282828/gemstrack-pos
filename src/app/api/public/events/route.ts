/**
 * POST /api/public/events — the house's site counting its visits and the interest in its pieces
 * (lib/website/site-analytics.ts, lib/website/piece-interest.ts).
 *
 * Sent with navigator.sendBeacon as text/plain, so no preflight; JSON is accepted too. Only the
 * house's own site (WEBSITE_ORIGIN) is counted. Bots (by user agent), Do Not Track and Global Privacy
 * Control are dropped here as well as on the page. A visitor id is held to 400 batches an hour (a page beats
 * 120 times an hour) and an address to 3,000 (a mobile network's shared address), in this server's memory
 * (memory-limit.ts: no Firestore transaction per beacon).
 * The caller's address is used for that limit and its place (lib/website/geo.ts), then dropped: never stored.
 * Always answers 204: a beacon never reads the reply, and a bad batch must not make the page retry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { corsHeaders, preflight } from '@/lib/website/cors';
import { callerKey } from '@/lib/website/ratelimit';
import { karachiDay, PIECE_STATS, statsDocId, tallyEvents } from '@/lib/website/piece-interest';
import { placeFor } from '@/lib/website/geo';
import { memoryLimit } from '@/lib/website/memory-limit';
import {
  addDays, classifySource, dayUpdate, LIVE_MS, parseDevice, parseVisit, SITE_DAYS, SITE_LIVE, SITE_VISITORS, sourceKey,
} from '@/lib/website/site-analytics';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

const done = (req: NextRequest) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });

const siteHost = () => { try { return new URL(process.env.WEBSITE_ORIGIN || 'https://taheri.shop').host.replace(/^www\./, ''); } catch { return ''; } };

function fromOwnSite(req: NextRequest): boolean {
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!origin) return false;
  if (process.env.NODE_ENV !== 'production' && /localhost|127\.0\.0\.1/.test(origin)) return true;
  return host(origin) === siteHost();
}

export async function POST(req: NextRequest) {
  if (!fromOwnSite(req)) return done(req);
  if (req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') return done(req);
  const device = parseDevice(req.headers.get('user-agent') || '');
  if (device.bot) return done(req);
  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 20_000)); } catch { return done(req); }
  const tally = tallyEvents(body);
  const visit = parseVisit(body);
  if (!tally.size && !visit) return done(req);

  const ip = callerKey(req.headers);
  if (!memoryLimit('events', ip, 3000, 3600).ok || (visit && !memoryLimit('visitor', visit.v, 400, 3600).ok)) return done(req);

  const now = new Date();
  const day = karachiDay(now);
  const at = now.toISOString();
  const batch = adminDb.batch();
  for (const [piece, t] of tally) {
    const inc: Record<string, string | FieldValue> = { piece, lastAt: at };
    for (const [k, v] of Object.entries(t)) {
      if (!v) continue;
      inc[k] = FieldValue.increment(v);
      inc[`days.${day}.${k}`] = FieldValue.increment(v);
    }
    // update() takes the dotted day paths; set(merge) would store them as literal keys.
    batch.set(adminDb.collection(PIECE_STATS).doc(statsDocId(piece)), { piece }, { merge: true });
    batch.update(adminDb.collection(PIECE_STATS).doc(statsDocId(piece)), inc);
  }

  if (visit) {
    const place = placeFor(req.headers, ip);
    const source = classifySource(visit, siteHost());
    const hour = new Date(now.getTime() + 5 * 3600_000).getUTCHours();
    // Nested objects in set(merge): keys are kept as written, and the increments add up.
    batch.set(adminDb.collection(SITE_DAYS).doc(day), { day, ...dayUpdate(visit, { source, place, device, hour }, n => FieldValue.increment(n)) }, { merge: true });

    const live: Record<string, unknown> = {
      at: now.getTime(), path: visit.at || '/',
      cc: place.cc, region: place.region, city: place.city, device: device.device, browser: device.browser,
      source: sourceKey(source), isNew: visit.isNew, expireAt: new Date(now.getTime() + LIVE_MS + 3600_000),
    };
    if (visit.pages.length) { live.kind = visit.pages[visit.pages.length - 1].kind; live.pages = FieldValue.increment(visit.pages.length); }
    if (visit.opens) live.start = now.getTime();
    batch.set(adminDb.collection(SITE_LIVE).doc(visit.s), live, { merge: true });

    // The days a random id was seen, for unique visitors over any period; once a day per visitor.
    if (visit.firstToday) {
      batch.set(adminDb.collection(SITE_VISITORS).doc(visit.v), {
        last: day, days: FieldValue.arrayUnion(day), ...(visit.isNew ? { first: day } : {}),
        expireAt: new Date(`${addDays(day, 400)}T00:00:00Z`),
      }, { merge: true });
    }
  }
  await batch.commit().catch(e => console.warn('[events] could not count:', e instanceof Error ? e.message : e));
  return done(req);
}
