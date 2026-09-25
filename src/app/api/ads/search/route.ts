/**
 * GET ?type=place&q=Karachi   → places Meta can target (countries, regions, cities, areas, postcodes)
 * GET ?type=interest&q=gold   → interests, with how many people each covers
 * GET ?type=suggest&names=Jewelry,Gold → interests Meta suggests beside those
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate } from '@/lib/ads/gate';
import { graph } from '@/lib/ads/meta';

export const dynamic = 'force-dynamic';

interface GeoRow { key: string; name: string; type: string; country_code?: string; country_name?: string; region?: string }
interface InterestRow { id: string; name: string; audience_size_lower_bound?: number; audience_size_upper_bound?: number; path?: string[]; topic?: string }

const interest = (r: InterestRow) => ({
  id: String(r.id), name: r.name,
  size: r.audience_size_upper_bound ? [r.audience_size_lower_bound ?? 0, r.audience_size_upper_bound] as [number, number] : null,
  path: (r.path ?? []).slice(0, -1).join(' › ') || r.topic || null,
});

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const p = req.nextUrl.searchParams;
  const type = p.get('type');
  const q = (p.get('q') || '').trim().slice(0, 80);
  try {
    if (type === 'place') {
      if (q.length < 2) return NextResponse.json({ results: [] });
      const d = await graph<{ data?: GeoRow[] }>('search', { params: { type: 'adgeolocation', q, location_types: ['country', 'region', 'city', 'subcity', 'neighborhood', 'zip'], limit: 12 } });
      return NextResponse.json({
        results: (d.data ?? []).map(r => ({
          type: r.type === 'medium_geo_area' || r.type === 'large_geo_area' || r.type === 'small_geo_area' ? 'region' : r.type,
          key: String(r.key), name: r.name,
          detail: [r.region && r.region !== r.name ? r.region : '', r.country_name && r.type !== 'country' ? r.country_name : ''].filter(Boolean).join(', ') || undefined,
        })),
      });
    }
    if (type === 'interest') {
      if (q.length < 2) return NextResponse.json({ results: [] });
      const d = await graph<{ data?: InterestRow[] }>('search', { params: { type: 'adinterest', q, limit: 20 } });
      return NextResponse.json({ results: (d.data ?? []).map(interest) });
    }
    if (type === 'suggest') {
      const names = (p.get('names') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
      if (!names.length) return NextResponse.json({ results: [] });
      const d = await graph<{ data?: InterestRow[] }>('search', { params: { type: 'adinterestsuggestion', interest_list: names, limit: 15 } });
      return NextResponse.json({ results: (d.data ?? []).map(interest) });
    }
    return NextResponse.json({ error: 'Search for what?' }, { status: 400 });
  } catch (e) {
    return adsFail(e, `search ${type}`);
  }
}
