/**
 * POST: a key for this phone's home-screen widget (apps/iphone), which reads the four figures with
 * it (/api/widget/summary) when the app is closed and the person's sign-in cannot be used. Owners.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { newWidgetKey } from '@/lib/widget/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => ({})) as { label?: unknown };
  const key = await newWidgetKey(email, typeof body.label === 'string' ? body.label : 'iPhone widget');
  return NextResponse.json({ key });
}
