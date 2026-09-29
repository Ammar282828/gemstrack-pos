/**
 * Saved ads (lib/ads/studio/saved.ts).
 *
 * GET                        the folders and every saved ad (words, settings, thumbnail)
 * POST multipart             meta (JSON), image, photo, doc, [id] — save a made ad (with `id`: over itself)
 * POST { fromAd, folder }    keep an ad already in the ad account: its picture and words, into a folder
 * PATCH { id, folder?, name? }
 * DELETE ?id=
 */

import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { graph, MetaAdsError } from '@/lib/ads/meta';
import { requireAccount } from '@/lib/ads/settings';
import { deleteSaved, listFolders, listSaved, moveSaved, saveAd, type SavedKey } from '@/lib/ads/studio/saved';
import { savedInput } from '@/lib/ads/studio/saved-shape';
import { studioFail } from '@/lib/ads/studio/route-kit';
import type { AdFormat } from '@/lib/ads/studio/templates';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX = 12 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const [folders, items] = await Promise.all([listFolders(), listSaved()]);
    return NextResponse.json({ folders, items }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'saved');
  }
}

/** The nearest of Meta's frames to a picture's shape. */
const formatOf = (w: number, h: number): AdFormat => {
  const r = w / Math.max(1, h);
  return r > 1.4 ? 'landscape' : r > 0.9 ? 'square' : r > 0.7 ? 'portrait' : 'story';
};

const thumbOf = async (buf: Buffer) => `data:image/jpeg;base64,${(await sharp(buf).rotate().resize(200, 200, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer()).toString('base64')}`;

async function fromAd(adId: string, folder: string | null, by: string) {
  if (!/^\d+$/.test(adId)) throw Object.assign(new Error('Not an ad id.'), { status: 400 });
  const { act } = await requireAccount();
  const ad = await graph<{ account_id?: string; name?: string; creative?: { id?: string; image_url?: string; title?: string; body?: string } }>(adId, { params: { fields: 'account_id,name,creative{id,image_url,title,body}' } });
  if (`act_${ad.account_id}` !== act) throw new MetaAdsError('That belongs to another ad account, not this shop’s.', 403);
  let url = ad.creative?.image_url;
  if (!url && ad.creative?.id) {
    const c = await graph<{ thumbnail_url?: string }>(ad.creative.id, { params: { fields: 'thumbnail_url', thumbnail_width: 1080, thumbnail_height: 1080 } }).catch(() => ({} as { thumbnail_url?: string }));
    url = c.thumbnail_url;
  }
  if (!url) throw Object.assign(new Error('Meta gives no picture for that ad.'), { status: 404 });
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw Object.assign(new Error(`The ad’s picture didn’t come (${res.status}).`), { status: 502 });
  const raw = Buffer.from(await res.arrayBuffer());
  const image = await sharp(raw).rotate().jpeg({ quality: 90 }).toBuffer();
  const meta = await sharp(image).metadata();
  const input = savedInput({
    folder, name: ad.name || 'Ad', format: formatOf(meta.width ?? 1, meta.height ?? 1), template: 'clean',
    text: ad.creative?.body ?? '', headline: ad.creative?.title ?? '', fields: {}, thumb: await thumbOf(image),
  })!;
  return saveAd({ ...input, fromAd: adId }, { image }, by);
}

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    if ((req.headers.get('content-type') || '').includes('application/json')) {
      const b = (await req.json().catch(() => ({}))) as { fromAd?: string; folder?: string | null };
      if (!b.fromAd) return NextResponse.json({ error: 'Which ad?' }, { status: 400 });
      const folder = typeof b.folder === 'string' && /^[\w-]{1,40}$/.test(b.folder) ? b.folder : null;
      return NextResponse.json({ item: await fromAd(b.fromAd, folder, who) }, { headers: noStore });
    }
    const form = await req.formData();
    let meta: unknown = null;
    try { meta = JSON.parse(String(form.get('meta') || 'null')); } catch { /* refused below */ }
    const input = savedInput(meta);
    if (!input) return NextResponse.json({ error: 'That isn’t an ad to save.' }, { status: 400 });
    const files: Partial<Record<SavedKey, Buffer>> = {};
    for (const key of ['image', 'photo', 'doc'] as const) {
      const f = form.get(key);
      if (!(f instanceof File)) continue;
      if (f.size > MAX) return NextResponse.json({ error: `The ${key} is over 12 MB.` }, { status: 413 });
      files[key] = Buffer.from(await f.arrayBuffer());
    }
    if (!files.image) return NextResponse.json({ error: 'No picture was received.' }, { status: 400 });
    if (!input.thumb) input.thumb = await thumbOf(files.image);
    const id = String(form.get('id') || '') || undefined;
    if (id && !/^[\w-]{1,40}$/.test(id)) return NextResponse.json({ error: 'Not a saved ad.' }, { status: 400 });
    return NextResponse.json({ item: await saveAd(input, files, who, id) }, { headers: noStore });
  } catch (e) {
    return studioFail(e, 'saved');
  }
}

export async function PATCH(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { id?: string; folder?: string | null; name?: string };
    if (!b.id || !/^[\w-]{1,40}$/.test(b.id)) return NextResponse.json({ error: 'Which saved ad?' }, { status: 400 });
    const folder = b.folder === undefined ? undefined : typeof b.folder === 'string' && /^[\w-]{1,40}$/.test(b.folder) ? b.folder : null;
    await moveSaved(b.id, { folder, name: b.name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return studioFail(e, 'saved');
  }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[\w-]{1,40}$/.test(id)) return NextResponse.json({ error: 'Which saved ad?' }, { status: 400 });
  try { await deleteSaved(id); return NextResponse.json({ ok: true }); }
  catch (e) { return studioFail(e, 'saved'); }
}
