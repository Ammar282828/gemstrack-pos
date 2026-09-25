/**
 * POST { draft: AudienceDraft, goal?: optimisation goal } → roughly how many
 * people the audience holds (Meta's monthly-active estimate).
 *   → { lower, upper, ready }
 * v26 dropped the daily-reach curve, so the range is all Meta gives now.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { graph } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { buildTargeting, type AudienceDraft } from '@/lib/ads/targeting';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { draft, goal } = (await req.json().catch(() => ({}))) as { draft?: AudienceDraft; goal?: string };
  if (!draft?.places) return NextResponse.json({ error: 'No audience.' }, { status: 400 });
  try {
    const { act, settings } = await requireAccount();
    const targeting = buildTargeting(draft);
    const optimization = /^[A-Z_]+$/.test(goal ?? '') ? goal! : 'REACH';
    const promoted = ['CONVERSATIONS'].includes(optimization) && settings.pageId ? { promoted_object: { page_id: settings.pageId } } : {};
    try {
      const d = await graph<{ data?: { estimate_mau_lower_bound?: number; estimate_mau_upper_bound?: number; estimate_ready?: boolean }[] }>(`${act}/delivery_estimate`, {
        params: { targeting_spec: targeting, optimization_goal: optimization, ...promoted },
      });
      const row = d.data?.[0];
      return NextResponse.json({ lower: row?.estimate_mau_lower_bound ?? null, upper: row?.estimate_mau_upper_bound ?? null, ready: row?.estimate_ready ?? true });
    } catch {
      // The older estimate, which asks less of the targeting.
      const d = await graph<{ data?: { users_lower_bound?: number; users_upper_bound?: number; estimate_ready?: boolean } }>(`${act}/reachestimate`, { params: { targeting_spec: targeting } });
      return NextResponse.json({ lower: d.data?.users_lower_bound ?? null, upper: d.data?.users_upper_bound ?? null, ready: d.data?.estimate_ready ?? true });
    }
  } catch (e) {
    return adsFail(e, 'estimate');
  }
}
