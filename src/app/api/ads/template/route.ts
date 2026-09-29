/**
 * GET ?ad=<id> → the makings of a new ad like that one: goal, the same photos
 * (by their hashes) or the same post, its words, button and link, its ad set's
 * audience and budget — for New ad's "Make one like this". Nothing is created;
 * New ad shows it all for changing first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { actId, graph, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { fromMinor, type AdsAccount } from '@/lib/ads/shape';
import { goalFromAdset, isChannelLink, type AdPlan, type GoalKey } from '@/lib/ads/plan';
import { parseTargeting, type AudienceDraft } from '@/lib/ads/targeting';

export const dynamic = 'force-dynamic';

export interface AdTemplate {
  goal: GoalKey;
  source: AdPlan['source'];
  text: string; headline: string; link: string; button: AdPlan['button'];
  audience: AudienceDraft;
  budget: { kind: 'daily' | 'total'; amount: number };
  name: string;
}

const BUTTONS: AdPlan['button'][] = ['SHOP_NOW', 'LEARN_MORE', 'SEE_MORE', 'ORDER_NOW', 'CONTACT_US'];

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('ad') || '';
  if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Which ad?' }, { status: 400 });
  try {
    const { act } = await requireAccount();
    const ad = await graph<Record<string, unknown>>(id, { params: { fields: 'name,account_id,creative{object_story_spec,asset_feed_spec,source_instagram_media_id,effective_instagram_media_id,image_hash,title,body,call_to_action_type,thumbnail_url,instagram_permalink_url},adset{optimization_goal,destination_type,daily_budget,lifetime_budget,targeting}' } });
    if (`act_${ad.account_id}` !== actId(act)) throw new MetaAdsError('That ad belongs to another ad account.', 403);
    const acct = await graph<Pick<AdsAccount, 'currency'>>(act, { params: { fields: 'currency' } });
    const cur = String(acct.currency || 'PKR');
    const creative = (ad.creative ?? {}) as Record<string, unknown>;
    const adset = (ad.adset ?? {}) as Record<string, unknown>;
    const spec = (creative.object_story_spec ?? {}) as { link_data?: Record<string, unknown> };
    const link = (spec.link_data ?? {}) as { message?: string; name?: string; link?: string; image_hash?: string; call_to_action?: { type?: string; value?: { link?: string } }; child_attachments?: Array<{ image_hash?: string; name?: string; link?: string }> };
    const postId = (creative.source_instagram_media_id as string) || (creative.effective_instagram_media_id as string) || '';
    const boosted = !!creative.source_instagram_media_id;
    const cards = link.child_attachments ?? [];
    // An asset-feed ad (the studio's both-sizes or WhatsApp-or-Instagram ads): its pictures, words and link live there.
    const feed = (creative.asset_feed_spec ?? null) as { images?: Array<{ hash?: string; adlabels?: Array<{ name?: string }> }>; bodies?: Array<{ text?: string }>; titles?: Array<{ text?: string }>; link_urls?: Array<{ website_url?: string }>; optimization_type?: string } | null;
    const labelled = (name: string) => feed?.images?.find(i => i.adlabels?.some(l => l.name === name))?.hash;
    const feedMain = feed ? labelled('feed') ?? feed.images?.[0]?.hash : undefined;
    const feedVertical = feed ? labelled('vertical') : undefined;
    const hashes = feedMain ? [{ hash: feedMain, headline: '', link: '' }]
      : cards.length ? cards.map(c => ({ hash: c.image_hash ?? '', headline: c.name ?? '', link: c.link ?? '' })).filter(c => c.hash) : link.image_hash || creative.image_hash ? [{ hash: String(link.image_hash || creative.image_hash), headline: '', link: '' }] : [];
    // The pictures behind the hashes, so New ad can show them.
    let urls = new Map<string, string>();
    if (hashes.length) {
      const imgs = await graph<{ data?: Array<{ hash: string; url?: string }> }>(`${act}/adimages`, { params: { hashes: [...hashes.map(h => h.hash), ...(feedVertical ? [feedVertical] : [])], fields: 'hash,url' } }).catch(() => ({ data: [] }));
      urls = new Map((imgs.data ?? []).map(i => [i.hash, i.url ?? '']));
    }
    const source: AdPlan['source'] = boosted
      ? { kind: 'post', mediaId: postId, permalink: (creative.instagram_permalink_url as string) || undefined, thumb: (creative.thumbnail_url as string) || null }
      : { kind: 'photos', photos: hashes.map(h => ({ ...h, url: urls.get(h.hash) || null })), ...(feedVertical ? { vertical: { hash: feedVertical, url: urls.get(feedVertical) || null } } : {}) };
    const feedLink = feed?.link_urls?.[0]?.website_url || '';
    const ctaType = String(link.call_to_action?.type || creative.call_to_action_type || '');
    const daily = adset.daily_budget ? fromMinor(adset.daily_budget as string, cur) : 0;
    const lifetime = adset.lifetime_budget ? fromMinor(adset.lifetime_budget as string, cur) : 0;
    const anyLink = String(feedLink || link.call_to_action?.value?.link || link.link || '');
    const channel = isChannelLink(anyLink);
    const template: AdTemplate = {
      goal: channel ? 'channel' : feed?.optimization_type === 'DOF_MESSAGING_DESTINATION' ? 'messages' : goalFromAdset(String(adset.optimization_goal || ''), adset.destination_type as string | undefined, boosted),
      source,
      text: String(feed?.bodies?.[0]?.text || link.message || creative.body || ''),
      headline: String(feed?.titles?.[0]?.text || link.name || creative.title || ''),
      link: channel ? anyLink : String((feedLink && !/api\.whatsapp\.com/.test(feedLink) ? feedLink : '') || link.call_to_action?.value?.link || (link.link && !/whatsapp\.com|instagram\.com/.test(String(link.link)) ? link.link : '') || ''),
      button: (BUTTONS as string[]).includes(ctaType) ? (ctaType as AdPlan['button']) : 'SHOP_NOW',
      audience: parseTargeting(adset.targeting as Record<string, unknown> | undefined),
      budget: daily ? { kind: 'daily', amount: daily } : { kind: 'total', amount: lifetime || 0 },
      name: String(ad.name || ''),
    };
    return NextResponse.json({ template }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'template');
  }
}
