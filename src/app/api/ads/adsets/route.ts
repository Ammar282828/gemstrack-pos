/**
 * The ad set designer (lib/ads/adset-design.ts).
 *
 * GET ?campaign=<id>   the campaign an ad set would join: its objective, and whether it holds the budget
 * GET ?from=<adsetId>  an ad set to start from: its audience, budget, dates, goal, its ads and its campaign
 * POST { design }      the ad sets, each with its ads (copies of the chosen ads, or the boosted post),
 *                      made paused and switched on bottom-up only if asked. On a failure every ad set this
 *                      call made is deleted (and the campaign, if it made one), so nothing is left half-built.
 *
 * Every object is checked to be this house's own ad account first.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { planContext } from '@/lib/ads/context';
import { fromMinor } from '@/lib/ads/shape';
import { parseTargeting } from '@/lib/ads/targeting';
import { goalFromAdset } from '@/lib/ads/plan';
import { createCreative } from '@/lib/ads/create';
import { adCount, designAdsetParams, designCampaignParams, designProblems, postPlan, type AdSetDesign, type AdSetDraft } from '@/lib/ads/adset-design';
import { logAds } from '@/lib/ads/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_ADSETS = 6;
const MAX_ADS = 30;

async function mine<T extends Record<string, unknown>>(act: string, id: string, fields: string): Promise<T & { account_id?: string }> {
  if (!/^\d+$/.test(id)) throw new MetaAdsError('Not an ad id.', 400);
  const o = await graph<T & { account_id?: string }>(id, { params: { fields: `account_id,${fields}` } });
  if (`act_${o.account_id}` !== act) throw new MetaAdsError('That belongs to another ad account, not this shop’s.', 403);
  return o;
}

async function campaignInfo(act: string, id: string) {
  const c = await mine<{ name?: string; objective?: string; daily_budget?: string; lifetime_budget?: string }>(act, id, 'name,objective,daily_budget,lifetime_budget');
  return { id, name: c.name ?? '', objective: c.objective ?? '', budgeted: Number(c.daily_budget) > 0 || Number(c.lifetime_budget) > 0 };
}

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const q = req.nextUrl.searchParams;
  try {
    const { act, ctx } = await planContext();
    const from = q.get('from');
    if (from) {
      const s = await mine<{ name?: string; campaign_id?: string; optimization_goal?: string; destination_type?: string; daily_budget?: string; lifetime_budget?: string; start_time?: string; end_time?: string; targeting?: Record<string, unknown>; ads?: { data?: { id: string }[] } }>(
        act, from, 'name,campaign_id,optimization_goal,destination_type,daily_budget,lifetime_budget,start_time,end_time,targeting,ads.limit(50){id}');
      const campaign = s.campaign_id ? await campaignInfo(act, s.campaign_id) : null;
      const daily = Number(s.daily_budget) > 0, total = Number(s.lifetime_budget) > 0;
      const draft: Omit<AdSetDraft, 'key'> = {
        name: `${s.name ?? 'Ad set'} (new)`,
        goal: goalFromAdset(s.optimization_goal ?? '', s.destination_type, false),
        audience: parseTargeting(s.targeting),
        budget: {
          kind: total && !daily ? 'total' : 'daily',
          amount: daily ? fromMinor(s.daily_budget!, ctx.currency) : total ? fromMinor(s.lifetime_budget!, ctx.currency) : 0,
          start: null,
          end: s.end_time && Date.parse(s.end_time) > Date.now() ? s.end_time : null,
        },
      };
      return NextResponse.json({ campaign, draft, ads: (s.ads?.data ?? []).map(a => a.id), currency: ctx.currency, minDaily: ctx.minDaily, pixelId: ctx.pixelId ?? null }, { headers: noStore });
    }
    const id = q.get('campaign');
    return NextResponse.json({ campaign: id ? await campaignInfo(act, id) : null, currency: ctx.currency, minDaily: ctx.minDaily, pixelId: ctx.pixelId ?? null }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'adsets');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const { design } = (await req.json().catch(() => ({}))) as { design?: AdSetDesign };
  if (!design?.adsets?.length || !design.campaign || !design.ads) return NextResponse.json({ error: 'Nothing to make.' }, { status: 400 });
  if (design.adsets.length > MAX_ADSETS) return NextResponse.json({ error: `At most ${MAX_ADSETS} ad sets at once.` }, { status: 400 });
  if (adCount(design) > MAX_ADS) return NextResponse.json({ error: `That is ${adCount(design)} ads — at most ${MAX_ADS} at once.` }, { status: 400 });

  const made: string[] = [];
  let newCampaign = '';
  let step = 'the campaign';
  try {
    const { act, ctx } = await planContext();
    // The campaign's own objective and budget, never the page's word for them.
    if (design.campaign.kind === 'existing') {
      const c = await campaignInfo(act, design.campaign.id);
      design.campaign = { kind: 'existing', id: c.id, objective: c.objective, budgeted: c.budgeted, name: c.name };
    }
    const problems = designProblems(design, ctx);
    if (problems.length) return NextResponse.json({ error: problems[0], problems }, { status: 400 });
    if (design.ads.kind === 'copy') for (const id of design.ads.ids) await mine(act, id, 'id');

    const campaignId = design.campaign.kind === 'existing'
      ? design.campaign.id
      : (newCampaign = (await graph<{ id: string }>(`${act}/campaigns`, { method: 'POST', params: designCampaignParams(design as AdSetDesign & { campaign: { kind: 'new' } }) })).id);

    // A boosted post needs a creative per goal (its button follows the goal).
    const creatives = new Map<string, string>();
    const out: { id: string; name: string; ads: string[] }[] = [];
    for (const s of design.adsets) {
      step = `the ad set “${s.name.trim()}”`;
      const adsetId = (await graph<{ id: string }>(`${act}/adsets`, { method: 'POST', params: designAdsetParams(s, design, campaignId, ctx) })).id;
      made.push(adsetId);
      const ads: string[] = [];
      if (design.ads.kind === 'copy') {
        for (const adId of design.ads.ids) {
          step = `copying an ad into “${s.name.trim()}”`;
          const c = await graph<{ copied_ad_id?: string; ad_object_ids?: { copied_id?: string }[] }>(`${adId}/copies`, {
            method: 'POST', params: { adset_id: adsetId, status_option: 'PAUSED' }, timeoutMs: 55_000,
          });
          const id = c.copied_ad_id ?? c.ad_object_ids?.[0]?.copied_id;
          if (id) ads.push(id);
        }
      } else {
        step = `the boosted post in “${s.name.trim()}”`;
        let creativeId = creatives.get(s.goal);
        if (!creativeId) { creativeId = (await createCreative(act, postPlan(s, design), ctx)).id; creatives.set(s.goal, creativeId); }
        ads.push((await graph<{ id: string }>(`${act}/ads`, { method: 'POST', params: { name: s.name.trim(), adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' } })).id);
      }
      out.push({ id: adsetId, name: s.name.trim(), ads });
    }

    const warnings: string[] = [];
    let live = false;
    if (design.launch === 'live') {
      try {
        for (const s of out) { for (const a of s.ads) await graph(a, { method: 'POST', params: { status: 'ACTIVE' } }); await graph(s.id, { method: 'POST', params: { status: 'ACTIVE' } }); }
        if (newCampaign) await graph(newCampaign, { method: 'POST', params: { status: 'ACTIVE' } });
        live = true;
      } catch (e) {
        warnings.push(`Made, but Meta wouldn’t switch them on: ${e instanceof Error ? e.message : String(e)} They’re paused on the Campaigns tab.`);
      }
      if (live && design.campaign.kind === 'existing') {
        const c = await graph<{ effective_status?: string }>(campaignId, { params: { fields: 'effective_status' } }).catch(() => ({} as { effective_status?: string }));
        if (c.effective_status && c.effective_status !== 'ACTIVE') warnings.push('The campaign itself is paused — switch it on in Campaigns for these to run.');
      }
    }
    await logAds({ by: who, action: 'designed ad sets', target: campaignId, detail: { adsets: out.map(s => ({ id: s.id, name: s.name, ads: s.ads.length })), live } });
    return NextResponse.json({ campaignId, adsets: out, live, warnings });
  } catch (e) {
    // Leave nothing half-built: this call's ad sets (their ads go with them), and its campaign.
    for (const id of [...made].reverse()) await graph(id, { method: 'POST', params: { status: 'DELETED' } }).catch(() => undefined);
    if (newCampaign) await graph(newCampaign, { method: 'POST', params: { status: 'DELETED' } }).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    return adsFail(new MetaAdsError(`Meta refused ${step}: ${msg}`, e instanceof MetaAdsError ? e.status : 502, e instanceof MetaAdsError ? e.code : undefined, e instanceof MetaAdsError ? e.subcode : undefined), 'adsets');
  }
}
