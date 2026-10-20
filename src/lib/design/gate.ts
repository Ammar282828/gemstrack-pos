/**
 * Who may use the Design routes (plan §5.1). Two needs, never merged:
 *   'post'  the owner, staff and marketing (as postGate)
 *   'ads'   the owner and marketing (as adsGate) — the library with scores, the Board, Meta
 * Under NEXT_PUBLIC_OPEN_ACCESS anyone who reaches the app; nobody, in a house with the feature off.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail, type Role } from '@/lib/roles';
import { STORE_DESIGN } from '@/lib/store-config';

export type DesignNeed = 'post' | 'ads';

/** The decision itself, without the request: the status to refuse with, or who is let in. Pure, tested. */
export function designAccess(o: { enabled: boolean; open: boolean; email: string | null; role: Role; need: DesignNeed }): { who: string } | { status: 401 | 403 | 404; error: string } {
  if (!o.enabled) return { status: 404, error: 'Not part of this shop.' };
  if (o.open) return { who: 'counter' };
  if (!o.email) return { status: 401, error: 'Unauthorized' };
  const ok = o.role === 'owner' || o.role === 'marketing' || (o.need === 'post' && o.role === 'staff');
  return ok ? { who: o.email } : { status: 403, error: 'Forbidden' };
}

export async function designGate(req: NextRequest, need: DesignNeed, enabled = STORE_DESIGN): Promise<string | NextResponse> {
  const open = process.env.NEXT_PUBLIC_OPEN_ACCESS === '1';
  const email = enabled && !open ? await verifyRequestEmail(req) : null;
  const d = designAccess({ enabled, open, email, role: roleForEmail(email), need });
  return 'who' in d ? d.who : NextResponse.json({ error: d.error }, { status: d.status });
}

/** Whether the person `designGate` let in (its return value) may also see ads-scope designs. */
export const mayUseAds = (who: string): boolean => {
  if (who === 'counter') return true;
  const role = roleForEmail(who);
  return role === 'owner' || role === 'marketing';
};

/** A failure as an answer: an error carrying a 4xx `status` says so; anything else is a 500. */
export function designFail(e: unknown, where: string): NextResponse {
  const status = (e as { status?: unknown })?.status;
  if (typeof status === 'number' && status >= 400 && status < 500 && e instanceof Error) return NextResponse.json({ error: e.message }, { status });
  console.error(`[design] ${where}:`, e);
  return NextResponse.json({ error: 'Something went wrong. Try again; if it keeps happening, tell the shop admin.' }, { status: 500 });
}

export const noStore = { 'Cache-Control': 'no-store' };
