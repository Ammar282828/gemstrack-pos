/** POST { token }: a test notification to this iPhone alone (Settings → Notifications). Owners only. */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate, isDeviceToken } from '@/lib/push/gate';
import { pushToShop } from '@/lib/push/send';
import { STORE_CONFIG } from '@/lib/store-config';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isDeviceToken(body?.token)) return NextResponse.json({ error: 'No phone named.' }, { status: 400 });
  const r = await pushToShop({ kind: 'orders', title: 'Test notification', body: `${STORE_CONFIG.name}: notifications reach this iPhone.`, url: '/settings/alerts' }, { token: body.token });
  const said: Record<string, string> = {
    'no-key': 'No Apple push key is set yet: add it above.',
    none: 'This iPhone is not registered for notifications yet. Open the app again and allow notifications.',
    failed: `Apple refused it${r.error ? ` (${r.error})` : ''}.`,
    dev: 'A development server does not send notifications.',
  };
  return NextResponse.json({ ok: r.status === 'sent', ...r, ...(said[r.status] ? { message: said[r.status] } : {}) }, { status: r.status === 'sent' ? 200 : 409 });
}
