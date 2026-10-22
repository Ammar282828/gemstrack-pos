/**
 * POST /api/public/events — the house's site counting interest in its pieces (lib/website/piece-interest.ts).
 *
 * Sent with navigator.sendBeacon as text/plain, so no preflight; JSON is accepted too. Only the
 * house's own site (WEBSITE_ORIGIN) is counted, and a caller is held to a few hundred events an hour.
 * Always answers 204: a beacon never reads the reply, and a bad batch must not make the page retry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { corsHeaders, preflight } from '@/lib/website/cors';
import { callerKey, rateLimit } from '@/lib/website/ratelimit';
import { karachiDay, PIECE_STATS, statsDocId, tallyEvents } from '@/lib/website/piece-interest';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

const done = (req: NextRequest) => new NextResponse(null, { status: 204, headers: corsHeaders(req) });

function fromOwnSite(req: NextRequest): boolean {
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  const origin = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!origin) return false;
  if (process.env.NODE_ENV !== 'production' && /localhost|127\.0\.0\.1/.test(origin)) return true;
  return host(origin) === host(site);
}

export async function POST(req: NextRequest) {
  if (!fromOwnSite(req)) return done(req);
  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 20_000)); } catch { return done(req); }
  const tally = tallyEvents(body);
  if (!tally.size) return done(req);
  const limit = await rateLimit('events', callerKey(req.headers), 400, 3600).catch(() => ({ ok: true }));
  if (!limit.ok) return done(req);

  const day = karachiDay();
  const at = new Date().toISOString();
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
  await batch.commit().catch(e => console.warn('[events] could not count:', e instanceof Error ? e.message : e));
  return done(req);
}
