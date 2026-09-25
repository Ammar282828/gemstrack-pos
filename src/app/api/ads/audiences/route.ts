/**
 * GET → this house's audiences.
 * POST { kind: 'customers', name, segment }                 → a customer list from the POS (hashed here)
 *      { kind: 'refresh', id, segment }                     → add today's customers to one
 *      { kind: 'engagers', name, days, event }              → the house's Instagram engagers
 *      { kind: 'lookalike', name, origin, percent, country } → people like an audience
 * DELETE ?id= → gone (ads using it keep their other targeting).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { createCustomerAudience, createEngagementAudience, createLookalike, deleteAudience, listAudiences, refreshCustomerAudience, ENGAGEMENT_EVENTS } from '@/lib/ads/audiences';
import { SEGMENTS, type Segment } from '@/lib/ads/audience-rows';
import { logAds } from '@/lib/ads/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const segmentOf = (v: unknown): Segment => (SEGMENTS.some(s => s.key === v) ? (v as Segment) : 'all');
const nameOf = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 100) : fallback);

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const { act, settings } = await requireAccount();
    return NextResponse.json({ audiences: await listAudiences(act), segments: SEGMENTS, events: ENGAGEMENT_EVENTS, instagram: settings.instagramUsername }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'audiences');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { act, settings } = await requireAccount();
    let out: Record<string, unknown>;
    switch (b.kind) {
      case 'customers': {
        const segment = segmentOf(b.segment);
        out = await createCustomerAudience(act, nameOf(b.name, `POS customers — ${SEGMENTS.find(s => s.key === segment)!.label} (${today})`), segment);
        break;
      }
      case 'refresh': {
        out = await refreshCustomerAudience(act, String(b.id ?? ''), segmentOf(b.segment));
        break;
      }
      case 'engagers': {
        if (!settings.instagramUserId) throw new MetaAdsError('Choose the shop’s Instagram account on the Setup tab first.', 409);
        const days = Number(b.days) || 365;
        out = await createEngagementAudience(act, settings.instagramUserId, nameOf(b.name, `@${settings.instagramUsername ?? 'instagram'} engagers — ${days} days`), days, String(b.event ?? 'ig_business_profile_all'));
        break;
      }
      case 'lookalike': {
        const percent = Number(b.percent) || 1;
        const country = String(b.country ?? 'PK').toUpperCase();
        out = await createLookalike(act, String(b.origin ?? ''), nameOf(b.name, `Lookalike ${percent}% ${country} (${today})`), percent, country);
        break;
      }
      default:
        return NextResponse.json({ error: 'What kind of audience?' }, { status: 400 });
    }
    await logAds({ by: who, action: `audience ${b.kind}`, target: String(out.id ?? b.id ?? ''), name: typeof b.name === 'string' ? b.name : undefined, detail: { segment: b.segment ?? null, sent: out.sent ?? null } });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return adsFail(e, `audience ${String(b.kind)}`);
  }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  try {
    const { act } = await requireAccount();
    await deleteAudience(act, id);
    await logAds({ by: who, action: 'audience deleted', target: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return adsFail(e, 'audience delete');
  }
}
