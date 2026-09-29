/**
 * GET — the Meta pixel id the website loads (Ads → Setup → the website pixel), so choosing or
 * changing it in the ERP needs no website deploy. `{ id: null }` when none is chosen: the site
 * then loads nothing. CORS as the other public routes; cached five minutes.
 */

import { NextRequest } from 'next/server';
import { json, preflight } from '@/lib/website/cors';
import { loadAdsSettings } from '@/lib/ads/settings';
import { STORE_META_ADS } from '@/lib/store-config';

export const dynamic = 'force-dynamic';

export function OPTIONS(req: NextRequest) { return preflight(req); }

export async function GET(req: NextRequest) {
  const id = STORE_META_ADS ? (await loadAdsSettings().catch(() => null))?.pixelId ?? null : null;
  return json(req, { id }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
