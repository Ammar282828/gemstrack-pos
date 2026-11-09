/**
 * POST /api/admin/integrations — the integrations' credentials set from the back end (owner, 2026-11-09: "do all integration
 * on the backend, I don't want to enter anything on the front end"). Bearer CRON_SECRET (strict), so only the server's own
 * operators can call it. Body: { op, ...fields } for one of the owner's settings ops (Safepay public key, Safepay secret, TCS,
 * the bills mailbox); each runs exactly as the Settings form would, sealed server-side, first sync straight away. Nothing it
 * is given is logged or answered back.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isCronAuthorized } from '@/lib/api-auth';
import { runPaylinkOp } from '@/app/api/app/write/ops-paylinks';
import type { OpContext } from '@/app/api/app/write/op-context';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const OPS = new Set(['setSafepayKey', 'setSafepaySecret', 'setTcsCredentials', 'setBillMail']);

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req, { strict: true })) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  const op = typeof body?.op === 'string' ? body.op : '';
  if (!body || !OPS.has(op)) return NextResponse.json({ error: `op must be one of ${[...OPS].join(', ')}` }, { status: 400 });
  const ctx: OpContext = {
    email: 'server',
    log: async () => {},
    alert: () => {},
    followUps: [],
  };
  const res = await runPaylinkOp(op, body, ctx);
  return res ?? NextResponse.json({ error: 'Not handled' }, { status: 400 });
}
