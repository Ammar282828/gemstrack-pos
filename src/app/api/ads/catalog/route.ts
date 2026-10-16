/**
 * The product catalogues this house's Meta business has (the Shopify catalogue, synced by Shopify's Facebook &
 * Instagram app), and their product sets, for Advantage+ catalogue ads.
 * GET            → { catalogs: { id, name, products }[] }
 * GET ?catalog=  → { sets: { id, name, products }[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graphAll } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { businessOf } from '@/lib/ads/business';
import { catalogSets } from '@/lib/ads/catalog-sets';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  try {
    const catalog = req.nextUrl.searchParams.get('catalog');
    if (catalog) {
      if (!/^\d+$/.test(catalog)) return NextResponse.json({ error: 'No such catalogue.' }, { status: 400 });
      const sets = await graphAll<{ id: string; name: string; product_count?: number }>(`${catalog}/product_sets`, { fields: 'id,name,product_count' }, 200);
      return NextResponse.json({ sets: catalogSets(sets) }, { headers: noStore });
    }
    const { act } = await requireAccount();
    const business = await businessOf(act);
    const fields = { fields: 'id,name,product_count' };
    const [owned, client] = await Promise.all([
      graphAll<{ id: string; name: string; product_count?: number }>(`${business}/owned_product_catalogs`, fields, 50).catch(() => []),
      graphAll<{ id: string; name: string; product_count?: number }>(`${business}/client_product_catalogs`, fields, 50).catch(() => []),
    ]);
    const seen = new Set<string>();
    const catalogs = [...owned, ...client].filter(c => !seen.has(c.id) && seen.add(c.id)).map(c => ({ id: c.id, name: c.name, products: c.product_count ?? null }));
    return NextResponse.json({ catalogs }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'catalog');
  }
}
