/**
 * A creator's partnership ad code, checked with Meta before it goes into an ad.
 * GET ?code= → { ok, mediaId, creator, permalink, thumb, why }
 *
 * Meta's partnership-ads-advertisable-content (the older branded_content_advertisable_medias edge goes
 * away on 2026-12-01). A code Meta can't read here can still be tried: the ad itself is the last word.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { businessOf } from '@/lib/ads/business';

export const dynamic = 'force-dynamic';

interface Content {
  content_id?: string; permalink?: string; media_type?: string; thumbnail_url?: string; media_url?: string;
  author?: { ig_user_id?: string; display_name?: string; username?: string };
  partnership_info?: { ad_eligibility?: string; permission_status?: string };
}

const WHY: Record<string, string> = {
  INELIGIBLE: 'Meta says this post can’t run as an ad (Reels with tappable stickers or GIFs can’t).',
  NEEDS_ATTENTION: 'Meta says the post needs the creator’s attention before it can run.',
  EXCLUDED: 'The creator has excluded this post from ads.',
};

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const code = (req.nextUrl.searchParams.get('code') || '').trim();
  if (!/^\S{6,}$/.test(code)) return NextResponse.json({ error: 'Paste the whole ad code.' }, { status: 400 });
  try {
    const { act, settings } = await requireAccount();
    if (!settings.pageId || !settings.instagramUserId) return NextResponse.json({ error: 'Choose the Page and Instagram account on the Setup tab first.' }, { status: 409 });
    const business = await businessOf(act);
    const d = await graph<{ data?: Content[] }>(`${business}/partnership-ads-advertisable-content`, {
      params: { fb_page_id: settings.pageId, ig_user_id: settings.instagramUserId, ad_codes: JSON.stringify([code]) },
    }).catch(e => ({ data: [], error: e instanceof Error ? e.message : String(e) }) as { data: Content[]; error: string });
    const c = d.data?.[0];
    if (!c) {
      const err = (d as { error?: string }).error;
      return NextResponse.json({ ok: false, mediaId: null, creator: null, permalink: null, thumb: null, why: err ? `Meta couldn’t check the code (${err}). It can still be tried.` : 'Meta found no post for that code — check it with the creator.' }, { headers: noStore });
    }
    const status = c.partnership_info?.ad_eligibility ?? 'AD_READY';
    return NextResponse.json({
      ok: status === 'AD_READY',
      mediaId: c.content_id ?? null,
      creator: c.author?.username ?? c.author?.display_name ?? null,
      permalink: c.permalink ?? null,
      thumb: c.thumbnail_url ?? c.media_url ?? null,
      why: status === 'AD_READY' ? null : WHY[status] ?? `Meta says: ${status.toLowerCase().replace(/_/g, ' ')}.`,
    }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'partner');
  }
}
