/**
 * POST: a key for this phone's home-screen widget (apps/iphone), which reads the four figures with
 * it (/api/widget/summary) when the app is closed and the person's sign-in cannot be used. Owners.
 * DELETE: takes a key back ({ key } in the body) when the phone signs out of a business or the person is removed;
 * only the account the key was made for may revoke it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import crypto from 'node:crypto';
import { adminDb } from '@/lib/firebase-admin';
import { newWidgetKey } from '@/lib/widget/server';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => ({})) as { label?: unknown };
  const key = await newWidgetKey(email, typeof body.label === 'string' ? body.label : 'iPhone widget');
  return NextResponse.json({ key });
}

export async function DELETE(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => ({})) as { key?: unknown };
  const key = typeof body.key === 'string' ? body.key : '';
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(key)) return NextResponse.json({ error: 'Not a key.' }, { status: 400 });
  // Same hash as lib/widget/server.ts (the ERP keeps only this).
  const ref = adminDb.collection('widget_keys').doc(crypto.createHash('sha256').update(key).digest('hex'));
  const snap = await ref.get();
  // An unknown key is already gone; another account's key is not this person's to take back.
  if (snap.exists && String(snap.data()?.email || '').toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }
  if (snap.exists) await ref.delete();
  return NextResponse.json({ ok: true });
}
