/**
 * Drive folders named by link (lib/ads/studio/drive-link.ts): POST { link } adds one the ERP can read
 * (shared with it, or open to anyone with the link); DELETE ?id= takes it away. Nothing in Drive changes.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adsGate, noStore } from '@/lib/ads/gate';
import { STORE_AD_STUDIO } from '@/lib/store-config';
import { addLinkedFolder, removeLinkedFolder } from '@/lib/ads/studio/drive';
import { studioFail } from '@/lib/ads/studio/route-kit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  try {
    const b = (await req.json().catch(() => ({}))) as { link?: string };
    return NextResponse.json({ folder: await addLinkedFolder(String(b.link ?? '')) }, { headers: noStore });
  } catch (e) { return studioFail(e, 'drive'); }
}

export async function DELETE(req: NextRequest) {
  const who = await adsGate(req, STORE_AD_STUDIO);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!/^[\w-]{10,}$/.test(id)) return NextResponse.json({ error: 'Which folder?' }, { status: 400 });
  try { await removeLinkedFolder(id); return NextResponse.json({ ok: true }); }
  catch (e) { return studioFail(e, 'drive'); }
}
