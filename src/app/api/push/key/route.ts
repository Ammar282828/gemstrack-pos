/**
 * The Apple push key (Settings → Notifications → iPhone notifications): GET says whether one is
 * set, POST sets it from the .p8 file's text. Owners only. lib/push/apns-key.ts keeps it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushGate } from '@/lib/push/gate';
import { DEFAULT_TEAM_ID, checkApnsKey, keyIdFromFileName, normalizeP8 } from '@/lib/push/apns-key';
import { apnsKeyStatus, saveApnsKey } from '@/lib/push/store';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  try {
    return NextResponse.json(await apnsKeyStatus());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const email = await pushGate(req, 'owner');
  if (typeof email !== 'string') return email;
  const body = await req.json().catch(() => null) as { p8?: unknown; keyId?: unknown; teamId?: unknown; fileName?: unknown } | null;
  const p8 = normalizeP8(String(body?.p8 ?? ''));
  const keyId = String(body?.keyId || keyIdFromFileName(String(body?.fileName ?? '')) || '').trim().toUpperCase();
  const teamId = String(body?.teamId || DEFAULT_TEAM_ID).trim().toUpperCase();
  const wrong = checkApnsKey({ p8, keyId, teamId });
  if (wrong) return NextResponse.json({ error: wrong }, { status: 400 });
  try {
    await saveApnsKey({ p8, keyId, teamId }, email);
    return NextResponse.json({ ok: true, ...(await apnsKeyStatus()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
