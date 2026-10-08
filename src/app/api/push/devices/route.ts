/**
 * This iPhone's notifications (the ERP app): POST registers it or changes which kinds it gets,
 * GET reads that back, DELETE forgets it (signing out). lib/push/send.ts reads the list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate, isBundleId, isDeviceToken } from '@/lib/push/gate';
import { PUSH_KINDS, forgetDevices, readDevice, saveDevice, type PushKind } from '@/lib/push/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const token = req.nextUrl.searchParams.get('token');
  if (!isDeviceToken(token)) return NextResponse.json({ error: 'No phone named.' }, { status: 400 });
  const d = await readDevice(token);
  return NextResponse.json({ registered: !!d && d.email === email, off: d?.off ?? [], kinds: PUSH_KINDS });
}

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { token?: unknown; bundleId?: unknown; label?: unknown; off?: unknown } | null;
  if (!body || !isDeviceToken(body.token) || !isBundleId(body.bundleId)) return NextResponse.json({ error: 'Not a phone.' }, { status: 400 });
  const off = Array.isArray(body.off) ? body.off.filter((k): k is PushKind => (PUSH_KINDS as readonly string[]).includes(String(k))) : undefined;
  const d = await saveDevice({ token: body.token, bundleId: body.bundleId, email, label: typeof body.label === 'string' ? body.label : undefined, off });
  return NextResponse.json({ ok: true, off: d.off });
}

export async function DELETE(req: NextRequest) {
  const email = await pushGate(req, 'owner-or-staff');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { token?: unknown } | null;
  if (!isDeviceToken(body?.token)) return NextResponse.json({ error: 'No phone named.' }, { status: 400 });
  const d = await readDevice(body.token);
  if (d && d.email !== email) return NextResponse.json({ error: 'Not your phone.' }, { status: 403 });
  await forgetDevices([body.token]);
  return NextResponse.json({ ok: true });
}
