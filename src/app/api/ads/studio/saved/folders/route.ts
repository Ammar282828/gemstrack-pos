/**
 * Saved ads' folders: POST { name } · PATCH { id, name } · DELETE ?id= (what was inside stays, unfiled).
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { createFolder, deleteFolder, renameFolder } from '@/lib/ads/studio/saved';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';
const idOk = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{1,40}$/.test(id);

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: string };
    return NextResponse.json({ folder: await createFolder(String(b.name ?? '')) }, { headers: noStore });
  } catch (e) { return studioFail(e, 'folders'); }
}

export async function PATCH(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { id?: string; name?: string };
    if (!idOk(b.id)) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
    await renameFolder(b.id, String(b.name ?? ''));
    return NextResponse.json({ ok: true });
  } catch (e) { return studioFail(e, 'folders'); }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id');
  if (!idOk(id)) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  try { await deleteFolder(id); return NextResponse.json({ ok: true }); }
  catch (e) { return studioFail(e, 'folders'); }
}
