/**
 * Sending a new ad to Meta: campaign → ad set → creative → ad, all created
 * paused, then — only if asked — switched on from the bottom up. If any step
 * fails, the half-made campaign is deleted so nothing half-finished is left in
 * the account, and the error names the step with Meta's own words.
 *
 * Server-only.
 */

import { graph, MetaAdsError } from './meta';
import { adsetParams, campaignParams, creativeSpec, enhancementsRejected, NO_ENHANCEMENTS, planProblems, type AdPlan, type PlanContext } from './plan';

export interface Created { campaignId: string; adsetId: string; creativeId: string; adId: string; live: boolean; warnings: string[] }

/** The creative, with photo changes switched off — and if Meta doesn't know one of the switches, without that one. */
export async function createCreative(act: string, plan: AdPlan, ctx: PlanContext): Promise<{ id: string; dropped: string[] }> {
  let features: Record<string, unknown> = { ...NO_ENHANCEMENTS };
  const dropped: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await graph<{ id: string }>(`${act}/adcreatives`, { method: 'POST', params: creativeSpec(plan, ctx, { enhancements: features }) });
      return { id: d.id, dropped };
    } catch (e) {
      const unknown = e instanceof MetaAdsError && e.code === 100 ? enhancementsRejected(e.message).filter(k => k in features) : [];
      if (!unknown.length) throw e;
      dropped.push(...unknown);
      features = Object.fromEntries(Object.entries(features).filter(([k]) => !unknown.includes(k)));
    }
  }
  throw new MetaAdsError('Meta kept refusing the creative’s settings.', 502);
}

export async function createAd(act: string, plan: AdPlan, ctx: PlanContext): Promise<Created> {
  const problems = planProblems(plan, ctx);
  if (problems.length) throw new MetaAdsError(problems[0], 400);

  let campaignId = '';
  let step = 'the campaign';
  try {
    campaignId = (await graph<{ id: string }>(`${act}/campaigns`, { method: 'POST', params: campaignParams(plan) })).id;
    step = 'the audience and budget (ad set)';
    const adsetId = (await graph<{ id: string }>(`${act}/adsets`, { method: 'POST', params: adsetParams(plan, campaignId, ctx) })).id;
    step = 'the ad’s picture and words (creative)';
    const creative = await createCreative(act, plan, ctx);
    step = 'the ad';
    const adId = (await graph<{ id: string }>(`${act}/ads`, { method: 'POST', params: { name: plan.name, adset_id: adsetId, creative: { creative_id: creative.id }, status: 'PAUSED' } })).id;

    const warnings = creative.dropped.length ? [`Meta didn’t know ${creative.dropped.length === 1 ? 'one photo setting' : 'some photo settings'} (${creative.dropped.join(', ')}); check the preview before switching it on.`] : [];
    let live = false;
    if (plan.launch === 'live') {
      step = 'switching it on';
      try {
        for (const id of [adId, adsetId, campaignId]) await graph(id, { method: 'POST', params: { status: 'ACTIVE' } });
        live = true;
      } catch (e) {
        // Everything exists and is sound; it just stays paused. Say so rather than deleting a good ad.
        warnings.push(`Made, but Meta wouldn’t switch it on: ${e instanceof Error ? e.message : String(e)} It’s paused on the Campaigns tab.`);
      }
    }
    return { campaignId, adsetId, creativeId: creative.id, adId, live, warnings };
  } catch (e) {
    if (campaignId) await graph(campaignId, { method: 'POST', params: { status: 'DELETED' } }).catch(() => undefined);
    const msg = e instanceof Error ? e.message : String(e);
    throw new MetaAdsError(`Meta refused ${step}: ${msg}`, e instanceof MetaAdsError ? e.status : 502, e instanceof MetaAdsError ? e.code : undefined, e instanceof MetaAdsError ? e.subcode : undefined);
  }
}
