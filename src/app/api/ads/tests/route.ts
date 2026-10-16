/**
 * Ads → A/B tests.
 * GET  → { tests, adsets, currency }: this account's split tests, each cell's results over the test so far,
 *        and the ad sets that can go into a new one.
 * POST { name, adsetIds, start, end, purchases? } → { id }: a new split test (src/lib/ads/study.ts).
 *
 * The ERP reads each cell's numbers from Insights over the test's dates; Meta's own verdict (with its
 * confidence) is in Ads Manager's Experiments, linked from the page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph, graphAll, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { businessOf } from '@/lib/ads/business';
import { logAds } from '@/lib/ads/log';
import { metricsOf, resultOf, salesOf, type InsightRow } from '@/lib/ads/shape';
import { studyParams, studyProblems, type StudyInput } from '@/lib/ads/study';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface StudyRow {
  id: string; name: string; type?: string; start_time?: string | number; end_time?: string | number;
  cells?: { data?: { id: string; name: string; treatment_percentage?: number; adsets?: { data?: { id: string; name: string; optimization_goal?: string }[] } }[] };
}

const iso = (t: string | number | undefined) => (t === undefined ? null : new Date(typeof t === 'number' || /^\d+$/.test(String(t)) ? Number(t) * 1000 : String(t)).toISOString());
const day = (s: string) => s.slice(0, 10);

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const { act } = await requireAccount();
    const [acct, studies, adsets] = await Promise.all([
      graph<{ currency?: string }>(act, { params: { fields: 'currency' } }),
      graphAll<StudyRow>(`${act}/ad_studies`, { fields: 'id,name,type,start_time,end_time,cells{id,name,treatment_percentage,adsets{id,name,optimization_goal}}' }, 50).catch(() => [] as StudyRow[]),
      graphAll<{ id: string; name: string; effective_status?: string; campaign?: { name?: string } }>(`${act}/adsets`, {
        fields: 'id,name,effective_status,campaign{name}', filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED'] }]),
      }, 200),
    ]);
    const now = new Date().toISOString();
    const tests = await Promise.all(studies.filter(s => !s.type || s.type.startsWith('SPLIT_TEST')).slice(0, 15).map(async s => {
      const start = iso(s.start_time), end = iso(s.end_time);
      const until = end && end < now ? end : now;
      const cells = await Promise.all((s.cells?.data ?? []).map(async c => {
        const sets = c.adsets?.data ?? [];
        const rows = start && start < now
          ? await Promise.all(sets.map(a => graph<{ data?: InsightRow[] }>(`${a.id}/insights`, { params: { fields: 'spend,impressions,reach,clicks,inline_link_clicks,actions,action_values', time_range: JSON.stringify({ since: day(start), until: day(until) }) } }).then(d => d.data?.[0] ?? null).catch(() => null)))
          : [];
        const m = rows.map(metricsOf);
        const spend = m.reduce((a, x) => a + x.spend, 0);
        const result = sets.reduce((a, x, i) => a + (m[i] ? resultOf(m[i], x.optimization_goal)?.value ?? 0 : 0), 0);
        const resultLabel = sets[0] ? resultOf(m[0] ?? metricsOf(null), sets[0].optimization_goal)?.label ?? 'Results' : 'Results';
        const sales = m.map(salesOf).reduce((a, x) => ({ purchases: a.purchases + x.purchases, value: a.value + x.value }), { purchases: 0, value: 0 });
        return { name: c.name, share: c.treatment_percentage ?? null, adsets: sets.map(a => ({ id: a.id, name: a.name })), spend, result, resultLabel, costPerResult: result > 0 ? spend / result : null, purchases: sales.purchases, roas: spend > 0 && sales.value > 0 ? sales.value / spend : null };
      }));
      const priced = cells.filter(c => c.costPerResult !== null);
      const ahead = priced.length === cells.length && cells.length > 1 ? priced.reduce((b, c) => (c.costPerResult! < b.costPerResult! ? c : b)).name : null;
      return { id: s.id, name: s.name, start, end, running: !!start && start <= now && (!end || end > now), cells, ahead };
    }));
    return NextResponse.json({
      currency: String(acct.currency || 'PKR'),
      tests,
      adsets: adsets.map(a => ({ id: a.id, name: a.name, campaign: a.campaign?.name ?? '', status: a.effective_status ?? '' })),
    }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'tests');
  }
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const b = (await req.json().catch(() => ({}))) as Partial<StudyInput>;
  try {
    const { act, settings } = await requireAccount();
    const input: StudyInput = { name: String(b.name ?? ''), adsetIds: Array.isArray(b.adsetIds) ? b.adsetIds.map(String) : [], start: String(b.start ?? ''), end: String(b.end ?? ''), purchases: !!b.purchases, pixelId: settings.pixelId };
    const problems = studyProblems(input);
    if (problems.length) throw new MetaAdsError(problems[0], 400);
    const business = await businessOf(act);
    let d: { id: string };
    try {
      d = await graph<{ id: string }>(`${business}/ad_studies`, { method: 'POST', params: studyParams(input) });
    } catch (e) {
      // The purchase objective's event name is Meta's to know; without it Meta compares on each ad set's own result.
      if (!(input.purchases && e instanceof MetaAdsError && e.code === 100)) throw e;
      d = await graph<{ id: string }>(`${business}/ad_studies`, { method: 'POST', params: studyParams({ ...input, purchases: false }) });
    }
    await logAds({ by: who, action: 'A/B test', target: d.id, name: input.name, detail: { adsets: input.adsetIds, start: input.start, end: input.end } });
    return NextResponse.json({ id: d.id });
  } catch (e) {
    return adsFail(e, 'tests');
  }
}
