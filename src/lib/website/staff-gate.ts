/**
 * Who may move an online order: a signed-in owner or staff account, always.
 *
 * These routes confirm orders, mark money received and ship goods, and each sends WhatsApp from the
 * shop's number; anyone reaching them unchecked could make an unpaid order look paid. So a verified
 * token is required whatever else the ERP allows.
 *
 * The one exception is for running a checkout test on a development machine: a server-only variable
 * (no NEXT_PUBLIC_ prefix, so it never ships to a browser) that is also refused in production, so it
 * cannot be switched on anywhere these routes are reachable from the internet.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { FulfilmentError } from './fulfilment';

const DEV_BYPASS = process.env.WEBSITE_ACTIONS_DEV_BYPASS === '1' && process.env.NODE_ENV !== 'production';

/** The caller's email, or the response refusing them. */
export async function staffGate(req: NextRequest): Promise<string | NextResponse> {
  if (DEV_BYPASS) return 'dev-bypass';
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = roleForEmail(email);
  if (role !== 'owner' && role !== 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return email;
}

export function staffFail(e: unknown, label: string) {
  if (e instanceof FulfilmentError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error(`[${label}]`, e);
  return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 });
}
