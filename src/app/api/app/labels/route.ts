/**
 * Settings → Labels (Stock › Labels) for the iPhone app: the standard tag, and a piece's tag as the CSV a
 * label app like WEPrint imports (the page's "Download CSV for Selected Product").
 *
 * - GET: `{ standard }`, the tag the designer starts from and goes "Back to the standard tag" to
 *   (lib/writes/label-layout.ts), so the phone draws the same one.
 * - POST `{ sku }`: the CSV of that piece at the shop's rates now (lib/label-csv.ts, the page's own columns),
 *   with the byte-order mark the page's download puts in front for Excel, and the page's file name.
 *
 * Owners only: Stock is the owners' place (nav.ts), and the CSV carries the prices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import type { Settings } from '@/lib/store';
import { STANDARD_LABEL_LAYOUT } from '@/lib/writes/label-layout';
import { labelCsvFileName, pieceForCsv, productCsv } from '@/lib/label-csv';

export const dynamic = 'force-dynamic';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function owner(req: NextRequest): Promise<NextResponse | null> {
  const email = await verifyRequestEmail(req);
  if (!email) return bad('Sign in again.', 401);
  if (roleForEmail(email) !== 'owner') return bad('Labels are the owners’.', 403);
  return null;
}

export async function GET(req: NextRequest) {
  const refused = await owner(req);
  if (refused) return refused;
  return NextResponse.json({ standard: STANDARD_LABEL_LAYOUT });
}

export async function POST(req: NextRequest) {
  const refused = await owner(req);
  if (refused) return refused;
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return bad('Bad request'); }
  const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
  if (!sku || sku.length > 200 || sku.includes('/')) return bad('Please select a product to export.');

  const [piece, settings] = await Promise.all([
    adminDb.collection('products').doc(sku).get(),
    adminDb.collection('app_settings').doc('global').get(),
  ]);
  if (!piece.exists) return bad(`No piece ${sku} is in stock.`, 404);
  const csv = productCsv([pieceForCsv(sku, piece.data() ?? {})], (settings.data() ?? {}) as Settings);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${labelCsvFileName()}"`,
      'Cache-Control': 'no-store',
    },
  });
}
