/**
 * GET /api/public/featured → { featured: { key, note, at } | null }
 *
 * What the home page shows as the set of the day. Read by taheri.shop on
 * load; cached a minute at the edge so a busy morning does not hit the book
 * on every visit, and the counter's change still lands within a minute.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { loadFeatured } from '@/lib/website/featured';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function GET(req: NextRequest) {
  const f = await loadFeatured();
  const res = json(req, { featured: f ? { key: f.key, note: f.note, at: f.at } : null });
  res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  return res;
}
