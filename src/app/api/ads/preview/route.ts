/**
 * POST { plan } → how the ad will look on Instagram before anything is made:
 * Meta renders the unsaved creative (generatepreviews) for the feed, stories and
 * reels. → { previews: [{ format, src }] } — `src` a facebook.com frame address.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { planContext } from '@/lib/ads/context';
import { creativeSpec, type AdPlan } from '@/lib/ads/plan';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const FORMATS = ['INSTAGRAM_STANDARD', 'INSTAGRAM_STORY', 'INSTAGRAM_REELS'] as const;

function srcOf(html: string): string | null {
  const m = html.match(/src="([^"]+)"/);
  if (!m) return null;
  const src = m[1].replace(/&amp;/g, '&');
  try { return /(^|\.)facebook\.com$/.test(new URL(src).hostname) ? src : null; } catch { return null; }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { plan } = (await req.json().catch(() => ({}))) as { plan?: AdPlan };
  if (!plan?.source) return NextResponse.json({ error: 'Nothing to preview yet.' }, { status: 400 });
  try {
    const { act, ctx } = await planContext();
    if (!ctx.pageId || !ctx.instagramUserId) throw new MetaAdsError('Choose the Page and Instagram account on the Setup tab to see previews.', 409);
    if (plan.source.kind === 'photos' && !plan.source.photos.length) return NextResponse.json({ previews: [] });
    const { name: _n, ...creative } = creativeSpec({ ...plan, name: plan.name || 'Preview' }, ctx);
    const results = await Promise.all(FORMATS.map(f =>
      graph<{ data?: { body?: string }[] }>(`${act}/generatepreviews`, { params: { creative, ad_format: f } })
        .then(d => ({ format: f, src: d.data?.[0]?.body ? srcOf(d.data[0].body) : null, error: null as string | null }))
        .catch(e => ({ format: f, src: null, error: e instanceof Error ? e.message : String(e) }))));
    const ok = results.filter(r => r.src);
    if (!ok.length && results[0].error) throw new MetaAdsError(results[0].error, 422);
    return NextResponse.json({ previews: ok.map(({ format, src }) => ({ format, src })) });
  } catch (e) {
    return adsFail(e, 'preview');
  }
}
