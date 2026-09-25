/**
 * HEIC → JPEG for Post a Piece.
 *
 * The page draws photographs on a canvas, and a desktop browser cannot decode
 * the HEIC an iPhone hands over (Safari can; Chrome cannot). When the browser
 * fails to read one, the page sends it here and draws the JPEG that comes back.
 * Same converter Add Photos uses on its way to the website.
 */

import { NextRequest, NextResponse } from 'next/server';
import convertHeic from 'heic-convert';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { STORE_POST_PIECE } from '@/lib/store-config';
import { notInThisShop } from '@/lib/social/gate';
import { roleForEmail } from '@/lib/roles';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: NextRequest) {
  if (!STORE_POST_PIECE) return notInThisShop();
  if (!OPEN_ACCESS) {
    const email = await verifyRequestEmail(req);
    const role = email ? roleForEmail(email) : null;
    if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No photograph was received.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That photograph is over 25 MB.' }, { status: 413 });
  try {
    const jpeg = await convertHeic({ buffer: new Uint8Array(await file.arrayBuffer()), format: 'JPEG', quality: 0.92 });
    return new NextResponse(new Uint8Array(jpeg), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.warn('[post convert] HEIC conversion failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Could not read that photograph. Export it as a JPEG and try again.' }, { status: 415 });
  }
}
