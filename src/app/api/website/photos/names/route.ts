/**
 * Add photos → The Maisons, for the iPhone app (apps/iphone, WebsitePhotos.swift).
 *
 *   GET  ?folder=                     → { maison, houses } — whether this collection names its
 *                                       photographs by house and model, and the houses to choose from
 *   POST { folder, items: [{ house, model, ext }] }
 *                                     → { maison, names } — every photo's file name, in the tray's order
 *                                       (null for a collection that keeps the photographs' own names)
 *
 * The photographs themselves still go to /api/website/photos, one by one, with the name given here,
 * exactly as the web page sends them; this only says what each is called (lib/website/maison-batch.ts),
 * so the phone never keeps its own copy of how the site reads a Maisons file name.
 *
 * The same people as Add photos: a signed-in owner, staff or marketing account. Unlike the older
 * website routes it does not follow NEXT_PUBLIC_OPEN_ACCESS, which both houses have off for good.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { MAISON_HOUSES, isMaisonFolder } from '@/lib/website/maisons';
import { maisonBatchNames, maisonTrayProblem, type MaisonItem } from '@/lib/website/maison-batch';

export const dynamic = 'force-dynamic';

const MAX_ITEMS = 200;

async function gate(req: NextRequest): Promise<string | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const folder = req.nextUrl.searchParams.get('folder') || '';
  return NextResponse.json({ maison: isMaisonFolder(folder), houses: [...MAISON_HOUSES] }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const b = await req.json().catch(() => null) as { folder?: unknown; items?: unknown } | null;
  const folder = typeof b?.folder === 'string' ? b.folder : '';
  if (!folder) return NextResponse.json({ error: 'Choose a collection first.' }, { status: 400 });
  if (!Array.isArray(b?.items) || b.items.length > MAX_ITEMS) return NextResponse.json({ error: 'Send the photographs as a list.' }, { status: 400 });
  if (!isMaisonFolder(folder)) return NextResponse.json({ maison: false, names: null });
  const items: MaisonItem[] = b.items.map((x: unknown) => {
    const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    return { house: String(i.house ?? ''), model: String(i.model ?? '').slice(0, 160), ext: String(i.ext ?? 'jpg').slice(0, 5) };
  });
  const problem = maisonTrayProblem(items);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  return NextResponse.json({ maison: true, names: maisonBatchNames(items) });
}
