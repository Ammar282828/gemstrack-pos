/**
 * The Mac app's page snapshots (apps/iphone/Mac/MacSnapshots.swift, Help › Send Page Snapshots): the app walks every
 * place in its sidebar, takes a picture of the window at each and sends it here, so the people working on the Mac app
 * see what the owner's Mac draws without the owner taking and sending screenshots one by one. One JPEG per document in
 * Firestore `app_snapshots`, grouped by the run's id; a JPEG of a window kept under Firestore's 1 MiB document cap.
 *
 * Owners only: a page shows the books (names, sums), and the pictures stay in this business's own Firestore.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

/** Base64 characters of one picture: about 700 KB of JPEG, leaving room in the document for the rest. */
const MAX_IMAGE = 950_000;
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const image = typeof body?.image === 'string' ? body.image : '';
  const run = str(body?.run, 40);
  if (!body || !run || !image || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) {
    return NextResponse.json({ error: 'Not a snapshot.' }, { status: 400 });
  }
  await adminDb.collection('app_snapshots').add({
    email,
    at: new Date().toISOString(),
    run,
    n: int(body.n) ?? 0,
    path: str(body.path, 200),
    title: str(body.title, 120),
    build: str(body.build, 40),
    width: int(body.width),
    height: int(body.height),
    image,
  });
  return NextResponse.json({ ok: true });
}
