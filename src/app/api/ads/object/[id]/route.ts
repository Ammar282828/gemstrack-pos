/**
 * One campaign, ad set or ad (`?level=`), always of this house's own ad account
 * — the same login may see the other house's account too, and Mina's POS must
 * never touch Taheri's ads or the reverse.
 *
 * GET  → its details: an ad's previews (Instagram feed / story / reels) and
 *        Meta's review notes; an ad set's audience, budget and schedule.
 * POST { action, … }:
 *   status    { status: 'ACTIVE' | 'PAUSED' }
 *   budget    { daily?: number, lifetime?: number }        (in the account's currency)
 *   rename    { name }
 *   schedule  { end: ISO | null, start?: ISO }            (a campaign's stop_time, an ad set's end_time)
 *   targeting { draft: AudienceDraft }                     (ad sets; merged over what Meta has)
 *   duplicate {}                                           (a paused copy, with everything under it)
 *   archive   {} / delete {}
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { toMinor, type Level } from '@/lib/ads/shape';
import { buildTargeting, mergeTargeting, type AudienceDraft } from '@/lib/ads/targeting';
import { logAds } from '@/lib/ads/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const LEVELS: Level[] = ['campaign', 'adset', 'ad'];
const levelOf = (v: string | null): Level | null => (LEVELS.includes(v as Level) ? (v as Level) : null);

/** The object, if it is this house's. */
async function own(id: string): Promise<{ act: string; currency: string }> {
  if (!/^\d+$/.test(id)) throw new MetaAdsError('Not an ad id.', 400);
  const { act } = await requireAccount();
  const [obj, acct] = await Promise.all([
    graph<{ account_id?: string }>(id, { params: { fields: 'account_id' } }),
    graph<{ currency?: string }>(act, { params: { fields: 'currency' } }),
  ]);
  if (`act_${obj.account_id}` !== act) throw new MetaAdsError('That belongs to another ad account, not this shop’s.', 403);
  return { act, currency: String(acct.currency || 'PKR') };
}

const PREVIEW_FORMATS = ['INSTAGRAM_STANDARD', 'INSTAGRAM_STORY', 'INSTAGRAM_REELS', 'MOBILE_FEED_STANDARD'] as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const level = levelOf(req.nextUrl.searchParams.get('level'));
  if (!level) return NextResponse.json({ error: 'Which level?' }, { status: 400 });
  try {
    const { currency } = await own(id);
    if (level === 'ad') {
      const [ad, ...previews] = await Promise.all([
        graph<Record<string, unknown>>(id, { params: { fields: 'name,status,effective_status,issues_info,ad_review_feedback,created_time,creative{id,name,title,body,image_url,thumbnail_url,instagram_permalink_url,call_to_action_type,object_story_spec,source_instagram_media_id},adset{id,name,optimization_goal,destination_type}' } }),
        ...PREVIEW_FORMATS.map(f => graph<{ data?: { body?: string }[] }>(`${id}/previews`, { params: { ad_format: f } })
          .then(d => ({ format: f, html: d.data?.[0]?.body ?? null }))
          .catch(() => ({ format: f, html: null }))),
      ]);
      return NextResponse.json({ level, currency, ad, previews: previews.filter(p => p.html) }, { headers: noStore });
    }
    const fields = level === 'adset'
      ? 'name,status,effective_status,optimization_goal,billing_event,destination_type,daily_budget,lifetime_budget,start_time,end_time,targeting,promoted_object,bid_strategy,learning_stage_info,issues_info,campaign{id,name,objective}'
      : 'name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,buying_type,bid_strategy,issues_info';
    const obj = await graph<Record<string, unknown>>(id, { params: { fields } });
    return NextResponse.json({ level, currency, [level]: obj }, { headers: noStore });
  } catch (e) {
    return adsFail(e, `object ${level}`);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string; level?: string; status?: string; daily?: number; lifetime?: number; name?: string;
    end?: string | null; start?: string; draft?: AudienceDraft;
  };
  const level = levelOf(body.level ?? null);
  if (!level) return NextResponse.json({ error: 'Which level?' }, { status: 400 });
  try {
    const { currency } = await own(id);
    const post = (p: Record<string, unknown>) => graph(id, { method: 'POST', params: p });
    switch (body.action) {
      case 'status': {
        if (body.status !== 'ACTIVE' && body.status !== 'PAUSED') return NextResponse.json({ error: 'Running or paused?' }, { status: 400 });
        await post({ status: body.status });
        break;
      }
      case 'budget': {
        if (level === 'ad') return NextResponse.json({ error: 'Ads have no budget of their own.' }, { status: 400 });
        const daily = Number(body.daily), lifetime = Number(body.lifetime);
        if (body.daily !== undefined) {
          if (!(daily > 0)) return NextResponse.json({ error: 'The daily budget must be more than zero.' }, { status: 400 });
          await post({ daily_budget: toMinor(daily, currency) });
        } else if (body.lifetime !== undefined) {
          if (!(lifetime > 0)) return NextResponse.json({ error: 'The total budget must be more than zero.' }, { status: 400 });
          await post({ lifetime_budget: toMinor(lifetime, currency) });
        } else return NextResponse.json({ error: 'What budget?' }, { status: 400 });
        break;
      }
      case 'rename': {
        const name = String(body.name ?? '').trim().slice(0, 200);
        if (!name) return NextResponse.json({ error: 'A name, please.' }, { status: 400 });
        await post({ name });
        break;
      }
      case 'schedule': {
        if (level === 'ad') return NextResponse.json({ error: 'Ads follow their ad set’s schedule.' }, { status: 400 });
        const endKey = level === 'campaign' ? 'stop_time' : 'end_time';
        const p: Record<string, unknown> = {};
        if (body.end !== undefined) {
          if (body.end !== null && !Number.isFinite(Date.parse(body.end))) return NextResponse.json({ error: 'That end date is not a date.' }, { status: 400 });
          // Meta takes 0 for "no end" on an ad set with a daily budget.
          p[endKey] = body.end === null ? 0 : new Date(body.end).toISOString();
        }
        if (body.start) {
          if (!Number.isFinite(Date.parse(body.start))) return NextResponse.json({ error: 'That start date is not a date.' }, { status: 400 });
          p.start_time = new Date(body.start).toISOString();
        }
        if (!Object.keys(p).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
        await post(p);
        break;
      }
      case 'targeting': {
        if (level !== 'adset') return NextResponse.json({ error: 'Audiences belong to ad sets.' }, { status: 400 });
        if (!body.draft) return NextResponse.json({ error: 'No audience was sent.' }, { status: 400 });
        const current = await graph<{ targeting?: Record<string, unknown> }>(id, { params: { fields: 'targeting' } });
        await post({ targeting: mergeTargeting(current.targeting ?? {}, buildTargeting(body.draft)) });
        break;
      }
      case 'duplicate': {
        const copy = await graph<Record<string, unknown>>(`${id}/copies`, {
          method: 'POST',
          params: { status_option: 'PAUSED', ...(level === 'ad' ? {} : { deep_copy: true }), rename_options: { rename_suffix: ' (copy)' } },
          timeoutMs: 55_000,
        });
        await logAds({ by: who, action: 'duplicated', target: id, detail: { level, copy } });
        return NextResponse.json({ ok: true, copy });
      }
      case 'archive': await post({ status: 'ARCHIVED' }); break;
      case 'delete': await post({ status: 'DELETED' }); break;
      default: return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    const { draft: _draft, ...detail } = body;
    await logAds({ by: who, action: body.action === 'status' ? (body.status === 'ACTIVE' ? 'switched on' : 'paused') : body.action, target: id, detail: { ...detail, currency } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return adsFail(e, `object ${body.action}`);
  }
}
