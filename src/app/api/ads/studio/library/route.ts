/**
 * GET the Ad studio's library: every photograph (website + shared Drive) with its
 * assessment, filtered, sorted and paged on the server — two and a half thousand
 * photos are too many to send a phone at once.
 *
 *   view=picks  the best for one placement (rankForAds): the page's opening row
 *   view=all    the whole library, newest first or by ad score
 *
 * Query: placement, source (all|site|drive), filter (all|unassessed|assessed|fixable|risky),
 * collection, q (words in the name, subject or collection), id (just that one), sort (newest|score),
 * offset, limit, fresh=1 (list both sources again).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, adsFail, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { listAssets, loadAssessments, usedAssetIds } from '@/lib/ads/studio/assets';
import { adScore, rankForAds, PLACEMENTS, type Placement } from '@/lib/ads/studio/assessment';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const q = req.nextUrl.searchParams;
    const fresh = q.get('fresh') === '1';
    const placement = (PLACEMENTS as readonly string[]).includes(q.get('placement') || '') ? q.get('placement') as Placement : 'portrait';
    const [lib, assessments, used] = await Promise.all([listAssets({ fresh }), loadAssessments(fresh), usedAssetIds()]);

    const rows = lib.assets.map(a => {
      const s = assessments.get(a.id);
      return { ...a, assessment: s?.assessment ?? null, assessedAt: s?.at ?? null, usedInAds: used.has(a.id), adScore: s ? adScore(s.assessment, placement) : null };
    });

    const counts = {
      total: rows.length,
      site: rows.filter(r => r.source === 'site').length,
      drive: rows.filter(r => r.source === 'drive').length,
      assessed: rows.filter(r => r.assessment).length,
    };
    const collections = [...rows.reduce((m, r) => m.set(r.collection, (m.get(r.collection) ?? 0) + 1), new Map<string, number>())]
      .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

    const source = q.get('source') || 'all';
    const filter = q.get('filter') || 'all';
    const collection = q.get('collection') || '';
    const words = (q.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean);
    const only = q.get('id');
    let list = rows.filter(r =>
      (!only || r.id === only)
      && (source === 'all' || r.source === source)
      && (!collection || r.collection === collection)
      && (filter === 'all'
        || (filter === 'unassessed' && !r.assessment)
        || (filter === 'assessed' && r.assessment)
        || (filter === 'fixable' && r.assessment && r.assessment.fixes.length > 0)
        || (filter === 'risky' && r.assessment && (r.assessment.brandRisks.length > 0 || r.assessment.burnedText)))
      && words.every(w => `${r.name} ${r.collection} ${r.assessment?.subject ?? ''} ${r.assessment?.category ?? ''}`.toLowerCase().includes(w)));

    if (q.get('view') === 'picks') {
      const count = Math.min(48, Number(q.get('limit')) || 24);
      const picks = rankForAds(list, { placement, count, minScore: 40 });
      return NextResponse.json({ placement, counts, collections, drive: lib.drive, siteError: lib.siteError, total: picks.length, items: picks }, { headers: noStore });
    }

    if (q.get('sort') === 'score') list = [...list].sort((a, b) => (b.adScore ?? -1) - (a.adScore ?? -1));
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    const limit = Math.min(120, Math.max(1, Number(q.get('limit')) || 60));
    return NextResponse.json({
      placement, counts, collections, drive: lib.drive, siteError: lib.siteError,
      total: list.length, items: list.slice(offset, offset + limit),
      unassessed: list.filter(r => !r.assessment).map(r => r.id).slice(0, 3000),
    }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'studio/library');
  }
}
