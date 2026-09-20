/**
 * The set of the day, from the counter.
 *
 *   GET     → what is featured now
 *   PUT     → { key, note? } feature this piece
 *   DELETE  → take it down
 *
 * Follows NEXT_PUBLIC_OPEN_ACCESS like the rest of the book.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { loadFeatured, saveFeatured } from '@/lib/website/featured';
import { collectionOfKey } from '@/lib/website/pricing';

export const dynamic = 'force-dynamic';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

async function gate(req: NextRequest): Promise<string | NextResponse> {
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

const site = () => (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');

function shape(f: Awaited<ReturnType<typeof loadFeatured>>) {
  if (!f) return { featured: null };
  return { featured: { ...f, collection: collectionOfKey(f.key), file: f.key.split('/').pop()!.replace(/\.webp$/i, ''), thumb: `${site()}/catalog-thumb/${encodeURI(f.key)}` } };
}

export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  return NextResponse.json(shape(await loadFeatured()), { headers: { 'Cache-Control': 'no-store' } });
}

const Put = z.object({
  // Category/Sub/file.webp — two slashes, no dot-segments.
  key: z.string().min(3).max(300).refine(k => k.split('/').length === 3 && !k.split('/').some(s => !s || s === '.' || s === '..'), 'key must be Category/Collection/file'),
  note: z.string().max(160).optional(),
});

export async function PUT(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const parsed = Put.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Bad request' }, { status: 400 });
  const key = parsed.data.key.endsWith('.webp') ? parsed.data.key : parsed.data.key.replace(/\.[^.]+$/, '') + '.webp';
  const f = { key, note: (parsed.data.note || '').trim(), at: new Date().toISOString(), by: who };
  await saveFeatured(f);
  return NextResponse.json(shape(f));
}

export async function DELETE(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  await saveFeatured(null);
  return NextResponse.json({ featured: null });
}
