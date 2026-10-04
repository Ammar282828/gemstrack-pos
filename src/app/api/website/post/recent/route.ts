/**
 * The Posts hub's "Out today": what went out in the last two days, one line per piece
 * (lib/social/sent-log.ts), from the send log every posting path writes (`social_posts`).
 *
 *   GET → { sent: Sent[] }, newest first
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { postGate } from '@/lib/social/gate';
import { groupSends, type SentRow } from '@/lib/social/sent-log';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const who = await postGate(req);
  if (who instanceof NextResponse) return who;
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const snap = await adminDb.collection('social_posts').where('at', '>=', since).orderBy('at', 'desc').limit(400).get();
  const rows: SentRow[] = snap.docs.map(d => {
    const x = d.data();
    return {
      at: String(x.at || ''), destination: String(x.destination || ''),
      ...(x.sitePiece ? { sitePiece: String(x.sitePiece) } : {}), ...(x.queue ? { queue: String(x.queue) } : {}),
      ...(x.fileName ? { fileName: String(x.fileName) } : {}), caption: String(x.caption || '').slice(0, 200),
    };
  });
  return NextResponse.json({ sent: groupSends(rows) }, { headers: { 'Cache-Control': 'no-store' } });
}
