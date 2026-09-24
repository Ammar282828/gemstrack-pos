/**
 * GET → an image being posted to Instagram right now, so Instagram can fetch
 * it. Public by necessity (Instagram's servers carry no sign-in); held only
 * for the minutes a post takes, under an id nobody can guess, and refused
 * once it is an hour old in case a delete was missed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) return new NextResponse('Not found', { status: 404 });
  const snap = await adminDb.collection('social_media').doc(id).get();
  const d = snap.data() as { data?: Buffer; contentType?: string; createdAt?: string } | undefined;
  if (!d?.data || !d.createdAt || Date.now() - new Date(d.createdAt).getTime() > 3_600_000) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(new Uint8Array(d.data), { headers: { 'Content-Type': d.contentType || 'image/jpeg', 'Cache-Control': 'no-store' } });
}
