/**
 * Who may use the Ads routes: whoever the POS lets in (the owner, 2026-09-25:
 * "open like the rest"). Under NEXT_PUBLIC_OPEN_ACCESS that is anyone who
 * reaches the app; otherwise a verified owner — ad money is owners' business,
 * like Expenses and Analytics, which staff don't see. Nobody, in a house with
 * the feature off.
 *
 * Also the one way every route turns a failure into an answer, with Meta's own
 * words and the right status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { STORE_META_ADS } from '@/lib/store-config';
import { SecretError } from '@/lib/secret-manager';
import { MetaAdsError } from './meta';

const OPEN_ACCESS = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';

export async function adsGate(req: NextRequest): Promise<string | NextResponse> {
  if (!STORE_META_ADS) return NextResponse.json({ error: 'Not part of this shop.' }, { status: 404 });
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

export function adsFail(e: unknown, where: string): NextResponse {
  if (e instanceof MetaAdsError) {
    if (e.status >= 500) console.warn(`[ads] ${where}:`, e.message, e.fbtrace ?? '');
    return NextResponse.json({ error: e.message, code: e.code ?? null, subcode: e.subcode ?? null }, { status: e.status });
  }
  if (e instanceof SecretError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(`[ads] ${where}:`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Something went wrong' }, { status: 500 });
}

export const noStore = { 'Cache-Control': 'no-store' };
