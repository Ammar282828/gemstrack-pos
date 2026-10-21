/**
 * Settings → Connect an AI (lib/agent/keys.ts). The owner only.
 *
 *   GET            the keys (label, scopes, made by and when, expiry, last used, calls, last four characters),
 *                  the scopes this house offers, and `rules` ('locked' | 'open' | 'unknown': keys work only when locked)
 *   POST           { label, scopes, expiresAt? } → { key, info }: the whole key, this once
 *   DELETE ?id=    revoke one: it stops at once, with every connector signed in with it
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestEmail } from '@/lib/karigar-auth';
import { roleForEmail } from '@/lib/roles';
import { createKey, listKeys, revokeKey } from '@/lib/agent/keys';
import { availableScopes } from '@/lib/agent/scopes';
import { databaseRules } from '@/lib/agent/rules-guard';
import { adminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

async function owner(req: NextRequest): Promise<string | NextResponse> {
  const email = await verifyRequestEmail(req);
  if (!email) return NextResponse.json({ error: 'Sign in again.' }, { status: 401 });
  if (roleForEmail(email) !== 'owner') return NextResponse.json({ error: 'Only an owner can manage AI keys.' }, { status: 403 });
  return email;
}

const fail = (e: unknown) => {
  const status = typeof (e as { status?: unknown })?.status === 'number' ? (e as { status: number }).status : 500;
  if (status >= 500) console.error('[agent/keys]', e);
  return NextResponse.json({ error: status >= 500 ? 'Something went wrong. Try again.' : (e as Error).message }, { status });
};

const log = (email: string, title: string, detail: string, id: string) => {
  const at = new Date().toISOString();
  return adminDb.collection('activity_log').add({ action: 'ai.key', title, detail, relatedId: id, by: email, at, via: 'web', timestamp: at, eventType: 'ai.key', description: title, details: detail, entityId: id }).catch(() => undefined);
};

export async function GET(req: NextRequest) {
  const who = await owner(req);
  if (who instanceof NextResponse) return who;
  try {
    const [keys, rules] = await Promise.all([listKeys(), databaseRules()]);
    // `rules`: while not 'locked' every key is refused (rules-guard.ts); the page says what to do.
    return NextResponse.json({ keys, rules, scopes: availableScopes().map(({ available: _a, ...s }) => s) }, { headers: noStore });
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  const who = await owner(req);
  if (who instanceof NextResponse) return who;
  try {
    const b = await req.json().catch(() => ({})) as { label?: unknown; scopes?: unknown; expiresAt?: unknown };
    const made = await createKey({ label: String(b.label ?? ''), scopes: b.scopes, by: who, expiresAt: typeof b.expiresAt === 'string' && b.expiresAt ? b.expiresAt : null });
    await log(who, `AI key made: ${made.info.label}`, `May: ${made.info.scopes.join(', ')}${made.info.expiresAt ? ` · until ${made.info.expiresAt.slice(0, 10)}` : ''}`, made.info.id);
    return NextResponse.json(made, { headers: noStore });
  } catch (e) { return fail(e); }
}

export async function DELETE(req: NextRequest) {
  const who = await owner(req);
  if (who instanceof NextResponse) return who;
  const id = req.nextUrl.searchParams.get('id') || '';
  try {
    const keys = await listKeys();
    const k = keys.find(x => x.id === id);
    if (!(await revokeKey(id))) return NextResponse.json({ error: 'No such key.' }, { status: 404 });
    await log(who, `AI key revoked: ${k?.label ?? id}`, `${k?.calls ?? 0} calls`, id);
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (e) { return fail(e); }
}
