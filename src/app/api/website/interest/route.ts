/**
 * GET /api/website/interest?days=30 — what the house's site counted about each piece
 * (POST /api/public/events, lib/website/piece-interest.ts), with the piece's name, photo and page.
 * Owners, staff and marketing; days=0 is all time.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { getSitePieces } from '@/lib/website/site-pieces';
import { PIECE_STATS, windowed, type PieceStats } from '@/lib/website/piece-interest';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const days = Math.max(0, Math.min(365, Number(req.nextUrl.searchParams.get('days') ?? 30) || 0));
  const [snap, site] = await Promise.all([
    adminDb.collection(PIECE_STATS).get(),
    getSitePieces({ all: true }).catch(() => ({ site: '', pieces: [] })),
  ]);
  const byId = new Map(site.pieces.map(p => [p.id, p]));
  const pieces = snap.docs.map(d => {
    const s = d.data() as PieceStats;
    const t = windowed(s, days);
    const p = byId.get(s.piece);
    return {
      piece: s.piece, ...t,
      avgDwellMs: t.dwellN ? Math.round(t.dwellMs / t.dwellN) : 0,
      netSaves: Math.max(0, t.saves - t.unsaves),
      name: p?.name || s.piece.split('/').pop()!.replace(/\.webp$/i, ''),
      thumb: p?.thumb || '', url: p?.url || '', collection: p?.collection || '',
      lastAt: s.lastAt ?? null,
    };
  }).filter(p => p.views || p.saves || p.enquiries || p.dwellN);
  return NextResponse.json({ days, pieces });
}
