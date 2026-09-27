/**
 * GET [?after=cursor] → the ad account's own picture library — every image in
 * Ads Manager's media for this account (the ERP's uploads land there too), newest
 * first, to see them and reuse any in a new ad without uploading again.
 *   → { images: [{ hash, url, thumb, name, width, height, at }], after }
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsFail, adsGate, noStore } from '@/lib/ads/gate';
import { graph } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';

export const dynamic = 'force-dynamic';

interface Img { hash: string; url?: string; url_128?: string; name?: string; width?: number; height?: number; created_time?: string; status?: string }

export async function GET(req: NextRequest) {
  const who = await adsGate(req);
  if (who instanceof NextResponse) return who;
  const after = req.nextUrl.searchParams.get('after') || undefined;
  try {
    const { act } = await requireAccount();
    const d = await graph<{ data?: Img[]; paging?: { cursors?: { after?: string }; next?: string } }>(`${act}/adimages`, {
      params: { fields: 'hash,url,url_128,name,width,height,created_time,status', limit: 48, ...(after ? { after } : {}) },
    });
    const images = (d.data ?? [])
      .filter(i => i.url && i.status !== 'DELETED')
      .sort((a, b) => String(b.created_time ?? '').localeCompare(String(a.created_time ?? '')))
      .map(i => ({ hash: i.hash, url: i.url!, thumb: i.url_128 || i.url!, name: i.name ?? '', width: i.width ?? null, height: i.height ?? null, at: i.created_time ?? null }));
    return NextResponse.json({ images, after: d.paging?.next ? d.paging.cursors?.after ?? null : null }, { headers: noStore });
  } catch (e) {
    return adsFail(e, 'library');
  }
}
