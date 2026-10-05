/**
 * Who may use the Ads routes: whoever the POS lets in (the owner, 2026-09-25:
 * "open like the rest"). Under NEXT_PUBLIC_OPEN_ACCESS that is anyone who
 * reaches the app; otherwise a verified owner or marketing account (roles.ts;
 * the owner, 2026-10-05) — ad money is not the shop floor's business, like
 * Expenses and Analytics, which staff don't see. Nobody, in a house with the
 * feature off. The audiences built from the customer book stay owners' only
 * (`ownerOnly`).
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

export async function adsGate(req: NextRequest, enabled = STORE_META_ADS): Promise<string | NextResponse> {
  if (!enabled) return NextResponse.json({ error: 'Not part of this shop.' }, { status: 404 });
  if (OPEN_ACCESS) return 'counter';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'marketing') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

/** For the few ads routes that hand the shop's own records to Meta (customer audiences): owners only. */
export async function ownerOnly(req: NextRequest): Promise<NextResponse | null> {
  if (OPEN_ACCESS) return null;
  const email = await verifyRequestEmail(req);
  return email && roleForEmail(email) === 'owner' ? null : NextResponse.json({ error: 'Only an owner can do this.' }, { status: 403 });
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
