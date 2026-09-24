/**
 * Who may use Post a Piece's server routes: whoever the POS lets in. Under
 * NEXT_PUBLIC_OPEN_ACCESS that is anyone who reaches the app (the owner's
 * choice, as for Add Photos); otherwise a verified owner or staff account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { STORE_CONFIG } from '@/lib/store-config';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

export async function postGate(req: NextRequest): Promise<string | NextResponse> {
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

/** This deployment's public address — where Instagram sends the account holder back after approving. */
export function publicOrigin(req: NextRequest): string {
  return (STORE_CONFIG.appUrl || req.nextUrl.origin).replace(/\/+$/, '');
}

/**
 * Where Instagram's servers fetch a story image from. SOCIAL_MEDIA_ORIGIN is
 * the backend's own Google address (…hosted.app): it depends on no domain
 * registry, so a story can still post when the shop's domain can't be
 * resolved — as on 2026-09-24, when every .shop domain vanished for hours and
 * Instagram answered "Only photo or video can be accepted as media type".
 */
export function mediaOrigin(req: NextRequest): string {
  return (process.env.SOCIAL_MEDIA_ORIGIN || '').trim().replace(/\/+$/, '') || publicOrigin(req);
}
