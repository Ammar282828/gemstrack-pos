/**
 * The catalogue as the counter sees it, and where a weight gets written.
 *
 *   GET                              every photograph: collection, thumbnail,
 *                                    weight, and whether it came from the
 *                                    photo or from here. Counts on top.
 *   PUT { key, weightGrams|null }    record (or clear) a weight.
 *
 * Follows NEXT_PUBLIC_OPEN_ACCESS like the rest of the book: a weight is
 * catalogue data, the same kind the open rules already let anyone write
 * directly. It is not an action (nothing is sent, nothing is marked paid),
 * which is why the order-actions route does not follow the flag and this one
 * does. Closing open access closes this with it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { getCatalogAttributes, normalisePieceKey } from '@/lib/website/catalog-source';
import { getPosWeights, mergeWeights, setPosWeight } from '@/lib/website/weights';
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

export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const [catalog, pos] = await Promise.all([getCatalogAttributes(), getPosWeights(true)]);
  const merged = mergeWeights(catalog, pos);
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const pieces = Object.entries(merged)
    .map(([key, a]) => ({
      key,
      collection: collectionOfKey(key),
      file: key.split('/').pop()!.replace(/\.webp$/i, ''),
      thumb: `${site}/catalog-thumb/${encodeURI(key)}`,
      weightGrams: a.weightGrams ?? null,
      source: a.weightSource,
      labelWeightGrams: a.labelWeightGrams ?? null,
      enteredBy: pos[key]?.enteredBy ?? null,
      enteredAt: pos[key]?.enteredAt ?? null,
    }))
    .sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true }));
  const withWeight = pieces.filter(p => p.weightGrams).length;
  return NextResponse.json({ total: pieces.length, withWeight, missing: pieces.length - withWeight, pieces }, { headers: { 'Cache-Control': 'no-store' } });
}

const Put = z.object({ key: z.string().min(3).max(300), weightGrams: z.number().positive().max(5000).nullable() });

export async function PUT(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const parsed = Put.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Send { key, weightGrams }' }, { status: 400 });
  const key = normalisePieceKey(parsed.data.key);
  const catalog = await getCatalogAttributes();
  if (!catalog[key]) return NextResponse.json({ error: 'No such photograph in the catalogue' }, { status: 404 });
  await setPosWeight(key, parsed.data.weightGrams, who);
  return NextResponse.json({ ok: true, key, weightGrams: parsed.data.weightGrams });
}
