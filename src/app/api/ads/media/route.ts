/**
 * GET [?after=cursor] → the house's recent Instagram posts and reels, to promote
 * one as it is. Read through the Meta ads login (the Instagram account linked to
 * the Page), which also says whether Meta will let each be boosted; failing that,
 * through the Instagram Login that posts stories (Taheri), which lists the same
 * posts without that answer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { loadConnection as loadInstagram } from '@/lib/social/instagram';

export const dynamic = 'force-dynamic';

interface Media { id: string; caption?: string; media_type?: string; media_product_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string; boost_eligibility_info?: Record<string, unknown> }

const shape = (m: Media) => {
  const b = m.boost_eligibility_info as { eligible_to_boost?: boolean; boost_ineligible_reason?: string } | undefined;
  return {
    id: m.id,
    caption: m.caption ?? '',
    type: m.media_product_type === 'REELS' ? 'REEL' : m.media_type ?? 'IMAGE',
    thumb: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
    permalink: m.permalink ?? null,
    at: m.timestamp ?? null,
    boostable: b?.eligible_to_boost ?? null,
    why: b?.boost_ineligible_reason ?? null,
  };
};

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const after = req.nextUrl.searchParams.get('after') || undefined;
  try {
    const { settings } = await requireAccount();
    if (!settings.instagramUserId) throw new MetaAdsError('Choose the shop’s Instagram account on the Setup tab.', 409);
    const fields = 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp';
    try {
      const d = await graph<{ data?: Media[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${settings.instagramUserId}/media`, {
        params: { fields: `${fields},boost_eligibility_info`, limit: 24, ...(after ? { after } : {}) },
      }).catch(e => {
        // Some accounts don't answer the boost field; ask again without it.
        if (e instanceof MetaAdsError && e.code === 100) return graph<{ data?: Media[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${settings.instagramUserId}/media`, { params: { fields, limit: 24, ...(after ? { after } : {}) } });
        throw e;
      });
      return NextResponse.json({ media: (d.data ?? []).map(shape), after: d.paging?.next ? d.paging.cursors?.after ?? null : null, via: 'meta' }, { headers: noStore });
    } catch (e) {
      const ig = await loadInstagram().catch(() => null);
      if (!ig || ig.username.toLowerCase() !== (settings.instagramUsername ?? '').toLowerCase()) throw e;
      const q = new URLSearchParams({ fields, limit: '24', access_token: ig.token, ...(after ? { after } : {}) });
      const res = await fetch(`https://graph.instagram.com/v23.0/me/media?${q}`, { signal: AbortSignal.timeout(15_000) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw e;
      return NextResponse.json({ media: ((d.data ?? []) as Media[]).map(shape), after: d.paging?.next ? d.paging?.cursors?.after ?? null : null, via: 'instagram' }, { headers: noStore });
    }
  } catch (e) {
    return adsFail(e, 'media');
  }
}
