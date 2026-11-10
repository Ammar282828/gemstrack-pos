/**
 * The catalogue as the counter sees it, and where a weight gets written.
 *
 *   GET                              every photograph: collection, thumbnail,
 *                                    weight, whether it came from the photo
 *                                    or from here, and when it was added —
 *                                    newest first, the new uploads the site
 *                                    hasn't listed yet among them. Counts on top.
 *   PUT { key, weightGrams|null }    record (or clear) a weight: a listed
 *                                    photograph's, or a new upload's under the
 *                                    key it keeps once listed.
 *
 * Follows NEXT_PUBLIC_OPEN_ACCESS like the rest of the book: a weight is
 * catalogue data, the same kind the open rules already let anyone write
 * directly. It is not an action (nothing is sent, nothing is marked paid),
 * which is why the order-actions route does not follow the flag and this one
 * does. Closing open access closes this with it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { gzipJson } from '@/lib/http/gzip-json';
import { z } from 'zod';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { getCatalogAttributes, normalisePieceKey } from '@/lib/website/catalog-source';
import { getPosCarats, getPosWeights, mergeWeights, setPosCarats, setPosWeight } from '@/lib/website/weights';
import { listDrops } from '@/lib/website/site-pieces';
import { collectionOfKey } from '@/lib/website/pricing';

export const dynamic = 'force-dynamic';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

async function gate(req: NextRequest): Promise<string | NextResponse> {
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

export async function GET(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  // The new uploads too (2026-10-09, owner: "it's not showing me the latest rings that we've added"): the site's
  // list is only rebuilt now and then, and until it is, what was uploaded since sits in its drop folder.
  const [catalog, pos, carats, drops] = await Promise.all([getCatalogAttributes(), getPosWeights(true), getPosCarats(true), listDrops(site).catch(() => [])]);
  const merged = mergeWeights(catalog, pos);
  const listed = Object.entries(merged).map(([key, a]) => ({
    key,
    collection: collectionOfKey(key),
    file: key.split('/').pop()!.replace(/\.webp$/i, ''),
    thumb: `${site}/catalog-thumb/${encodeURI(key)}`,
    weightGrams: a.weightGrams ?? null,
    source: a.weightSource,
    labelWeightGrams: a.labelWeightGrams ?? null,
    enteredBy: pos[key]?.enteredBy ?? null,
    enteredAt: pos[key]?.enteredAt ?? null,
    added: addedMs((a as { added?: unknown }).added),
    drop: false,
    diamondCarats: carats[key]?.diamondCarats ?? null,
    diamond: isDiamond(key, a.stone),
  }));
  const fresh = drops.filter(d => !merged[d.key]).map(d => ({
    key: d.key,
    collection: collectionOfKey(d.key),
    file: d.name,
    thumb: d.thumb,
    weightGrams: pos[d.key]?.weightGrams ?? null,
    source: pos[d.key] ? ('pos' as const) : null,
    labelWeightGrams: null,
    enteredBy: pos[d.key]?.enteredBy ?? null,
    enteredAt: pos[d.key]?.enteredAt ?? null,
    added: d.added,
    drop: true,
    diamondCarats: carats[d.key]?.diamondCarats ?? null,
    diamond: isDiamond(d.key),
  }));
  // Newest first (owner: "show me the newest stuff first"); the undated after, by name.
  const pieces = [...fresh, ...listed].sort((x, y) => (y.added ?? 0) - (x.added ?? 0) || x.key.localeCompare(y.key, undefined, { numeric: true }));
  const withWeight = pieces.filter(p => p.weightGrams).length;
  return gzipJson(req, { total: pieces.length, withWeight, missing: pieces.length - withWeight, pieces }, { headers: { 'Cache-Control': 'no-store' } });
}

// Either or both: a weight in grams, the diamonds' carats (null clears one; left out leaves it as it is).
const Put = z.object({
  key: z.string().min(3).max(300),
  weightGrams: z.number().positive().max(5000).nullable().optional(),
  diamondCarats: z.number().positive().max(500).nullable().optional(),
}).refine(b => b.weightGrams !== undefined || b.diamondCarats !== undefined);

/**
 * A diamond piece, where the carats field shows: a diamond read on the photo by the site's tagger, or a collection
 * named for diamonds ("Diamond Rings").
 */
function isDiamond(key: string, stone?: string): boolean {
  return /diamond/i.test(stone ?? '') || /diamond/i.test(collectionOfKey(key));
}

export async function PUT(req: NextRequest) {
  const who = await gate(req);
  if (who instanceof NextResponse) return who;
  const parsed = Put.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Send { key, weightGrams } or { key, diamondCarats }' }, { status: 400 });
  const key = normalisePieceKey(parsed.data.key);
  const catalog = await getCatalogAttributes();
  // A new upload the site hasn't listed yet takes its weight under the key it keeps once listed. Its list is asked of
  // the site once in two minutes, not on every weight (2026-10-23, the owner: "adding weights is dead slow" — each save
  // waited on the shared host).
  if (!catalog[key] && !(await dropKeys()).has(key) && !(await dropKeys(true)).has(key)) {
    return NextResponse.json({ error: 'No such photograph in the catalogue' }, { status: 404 });
  }
  if (parsed.data.weightGrams !== undefined) await setPosWeight(key, parsed.data.weightGrams, who);
  if (parsed.data.diamondCarats !== undefined) await setPosCarats(key, parsed.data.diamondCarats, who);
  return NextResponse.json({ ok: true, key, weightGrams: parsed.data.weightGrams, diamondCarats: parsed.data.diamondCarats });
}

let drops: { at: number; keys: Set<string> } | null = null;
/** The site's new uploads' keys, kept two minutes; `fresh` asks again (a photo uploaded a moment ago). */
async function dropKeys(fresh = false): Promise<Set<string>> {
  if (!fresh && drops && Date.now() - drops.at < 120_000) return drops.keys;
  const site = (process.env.WEBSITE_ORIGIN || 'https://taheri.shop').replace(/\/+$/, '');
  const list = await listDrops(site).catch(() => null);
  if (list) drops = { at: Date.now(), keys: new Set(list.map(d => d.key)) };
  return drops?.keys ?? new Set();
}

/** The site's `added`: seconds or milliseconds since 1970, as ms; nothing for anything else. */
function addedMs(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v < 1e12 ? v * 1000 : v;
}
